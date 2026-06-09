// bus.js — module-level singleton: SQLite durability + in-process EventEmitter
// for sub-second long-poll wakeups + presence + push-wake + activity feed.
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.AGENTBUS_DB_PATH ?? "/data/agentbus.db";
const PRESENCE_TTL_MS = 60_000;
const ACTIVITY_CHANNEL = "#activity";
const DM = "@dm";
const WAKE_DEBOUNCE_MS = 2_000;

class Bus {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(readFileSync(join(__dir, "schema.sql"), "utf8"));
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0); // many concurrent long-poll waiters
    this.waiters = new Map(); // agentId -> active long-poll waiter count
    this.pendingWakes = new Set(); // agentIds with a debounced wake scheduled
    this.now = () => Date.now();
  }

  // ---- agents / presence ----
  registerAgent({ agent_id, name, capabilities, wake_url, wake_secret }) {
    const caps = JSON.stringify(capabilities ?? []);
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO agents (id, name, capabilities, last_seen, wake_url, wake_secret)
         VALUES (@id, @name, @caps, @now, @wake_url, @wake_secret)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           capabilities=excluded.capabilities,
           last_seen=excluded.last_seen,
           wake_url=COALESCE(excluded.wake_url, agents.wake_url),
           wake_secret=COALESCE(excluded.wake_secret, agents.wake_secret)`
      )
      .run({ id: agent_id, name, caps, now, wake_url: wake_url ?? null, wake_secret: wake_secret ?? null });
    return { ok: true, agent_id };
  }

  touch(agentId) {
    this.db.prepare(`UPDATE agents SET last_seen=? WHERE id=?`).run(this.now(), agentId);
  }

  listAgents() {
    const now = this.now();
    const rows = this.db.prepare(`SELECT id, name, capabilities, last_seen, last_activity, last_activity_at FROM agents`).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      capabilities: JSON.parse(r.capabilities || "[]"),
      last_seen: r.last_seen,
      online: now - r.last_seen < PRESENCE_TTL_MS,
      last_activity: r.last_activity ?? null,
      last_activity_at: r.last_activity_at ?? null,
    }));
  }

  // ---- channels ----
  createChannel({ channel_id, name }) {
    this.db
      .prepare(`INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(channel_id, name ?? channel_id, this.now());
    return { ok: true, channel_id };
  }

  listChannels() {
    return this.db
      .prepare(
        `SELECT c.id, c.name, (SELECT COUNT(*) FROM memberships m WHERE m.channel_id=c.id) AS member_count
         FROM channels c ORDER BY c.created_at`
      )
      .all();
  }

  joinChannel({ agent_id, channel_id }) {
    this.createChannel({ channel_id }); // idempotent
    this.db
      .prepare(`INSERT INTO memberships (agent_id, channel_id) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(agent_id, channel_id);
    // Start cursor at current head so the agent doesn't get flooded with history.
    const head = this.db.prepare(`SELECT COALESCE(MAX(id),0) AS m FROM messages`).get().m;
    this.db
      .prepare(
        `INSERT INTO read_cursors (agent_id, channel_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT(agent_id, channel_id) DO NOTHING`
      )
      .run(agent_id, channel_id, head);
    return { ok: true };
  }

  joinedChannels(agentId) {
    return this.db.prepare(`SELECT channel_id FROM memberships WHERE agent_id=?`).all(agentId).map((r) => r.channel_id);
  }

  // ---- messaging ----
  send({ from, to, channel_id, content, type, thread_id, reply_to }) {
    const now = this.now();
    const info = this.db
      .prepare(
        `INSERT INTO messages (channel_id, from_agent, to_agent, thread_id, reply_to, type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(channel_id ?? null, from, to ?? null, thread_id ?? null, reply_to ?? null, type ?? "chat", content, now);
    this.touch(from);
    const id = Number(info.lastInsertRowid);
    this.emitter.emit("message", { id, to, channel_id, from });
    this._maybeWake({ to, channel_id, from, id, content, type });
    return id;
  }

  cursor(agentId, scope) {
    const row = this.db.prepare(`SELECT last_read_id FROM read_cursors WHERE agent_id=? AND channel_id=?`).get(agentId, scope);
    return row ? row.last_read_id : 0;
  }

  setCursor(agentId, scope, id) {
    this.db
      .prepare(
        `INSERT INTO read_cursors (agent_id, channel_id, last_read_id) VALUES (?, ?, ?)
         ON CONFLICT(agent_id, channel_id) DO UPDATE SET last_read_id=MAX(last_read_id, excluded.last_read_id)`
      )
      .run(agentId, scope, id);
  }

  // Returns unread messages for agentId across its DM inbox + joined channels.
  // Advances cursors (drain) unless peek=true.
  drain(agentId, { limit = 100, peek = false } = {}) {
    const scopes = [{ scope: DM, sql: `SELECT * FROM messages WHERE to_agent=? AND id>?`, args: (c) => [agentId, c] }];
    for (const ch of this.joinedChannels(agentId)) {
      scopes.push({
        scope: ch,
        sql: `SELECT * FROM messages WHERE channel_id=? AND from_agent!=? AND id>?`,
        args: (c) => [ch, agentId, c],
      });
    }
    let rows = [];
    const maxByScope = {};
    for (const s of scopes) {
      const c = this.cursor(agentId, s.scope);
      const found = this.db.prepare(`${s.sql} ORDER BY id`).all(...s.args(c));
      for (const r of found) {
        rows.push(r);
        maxByScope[s.scope] = Math.max(maxByScope[s.scope] ?? 0, r.id);
      }
    }
    rows.sort((a, b) => a.id - b.id);
    if (rows.length > limit) rows = rows.slice(0, limit);
    if (!peek) {
      // Advance each scope cursor to the highest delivered id within that scope.
      const deliveredMax = {};
      for (const r of rows) {
        const scope = r.to_agent === agentId ? DM : r.channel_id;
        deliveredMax[scope] = Math.max(deliveredMax[scope] ?? 0, r.id);
      }
      for (const [scope, id] of Object.entries(deliveredMax)) this.setCursor(agentId, scope, id);
    }
    return rows.map(toMessage);
  }

  // Long-poll: resolve with >=1 message, or [] on timeout.
  async waitForMessage(agentId, timeoutMs, signal) {
    this.touch(agentId);
    const immediate = this.drain(agentId);
    if (immediate.length) return immediate;

    this.waiters.set(agentId, (this.waiters.get(agentId) ?? 0) + 1);
    try {
      return await new Promise((resolve) => {
        let done = false;
        const finish = (val) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.emitter.off("message", onMsg);
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve(val);
        };
        const onMsg = () => {
          const rows = this.drain(agentId);
          if (rows.length) finish(rows);
        };
        const onAbort = () => finish([]);
        const timer = setTimeout(() => finish([]), timeoutMs);
        this.emitter.on("message", onMsg);
        if (signal) {
          if (signal.aborted) return finish([]);
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    } finally {
      const n = (this.waiters.get(agentId) ?? 1) - 1;
      if (n <= 0) this.waiters.delete(agentId);
      else this.waiters.set(agentId, n);
    }
  }

  getMessages(agentId, { channel_id, since_id, limit = 50, peek = false, drain = true } = {}) {
    this.touch(agentId);
    if (since_id != null || channel_id != null) {
      // Explicit history read by cursor/channel — does not touch read_cursors.
      const where = [];
      const args = [];
      if (channel_id != null) {
        where.push(`channel_id=?`);
        args.push(channel_id);
      }
      if (since_id != null) {
        where.push(`id>?`);
        args.push(since_id);
      }
      const sql = `SELECT * FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id LIMIT ?`;
      args.push(limit);
      const rows = this.db.prepare(sql).all(...args).map(toMessage);
      const cursor = rows.length ? rows[rows.length - 1].id : since_id ?? 0;
      return { messages: rows, cursor };
    }
    // Default: drain the agent's unread inbox.
    const rows = this.drain(agentId, { limit, peek: peek || !drain });
    const cursor = rows.length ? rows[rows.length - 1].id : null;
    return { messages: rows, cursor };
  }

  ack(agentId, upToId) {
    // Advance every scope cursor for this agent up to upToId.
    const scopes = [DM, ...this.joinedChannels(agentId)];
    for (const scope of scopes) this.setCursor(agentId, scope, upToId);
    return { ok: true, cursor: upToId };
  }

  heartbeat(agentId) {
    this.touch(agentId);
    return { ok: true, online_agents: this.listAgents().filter((a) => a.online).map((a) => a.id) };
  }

  // ---- awareness layer ----
  setStatus({ agent_id, activity, detail }) {
    const now = this.now();
    this.db.prepare(`UPDATE agents SET last_activity=?, last_activity_at=?, last_seen=? WHERE id=?`).run(activity, now, now, agent_id);
    const content = JSON.stringify({ activity, detail: detail ?? null });
    const info = this.db
      .prepare(
        `INSERT INTO messages (channel_id, from_agent, to_agent, type, content, created_at)
         VALUES (?, ?, NULL, 'status', ?, ?)`
      )
      .run(ACTIVITY_CHANNEL, agent_id, content, now);
    const id = Number(info.lastInsertRowid);
    this.emitter.emit("message", { id, channel_id: ACTIVITY_CHANNEL, from: agent_id });
    return { ok: true, message_id: id };
  }

  getActivity({ since_id, limit = 50, agent_id } = {}) {
    const args = [ACTIVITY_CHANNEL];
    let sql = `SELECT * FROM messages WHERE channel_id=?`;
    if (since_id != null) {
      sql += ` AND id>?`;
      args.push(since_id);
    }
    if (agent_id != null) {
      sql += ` AND from_agent=?`;
      args.push(agent_id);
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    args.push(limit);
    const feed = this.db.prepare(sql).all(...args).map(toMessage).reverse();
    return { feed, agents: this.listAgents() };
  }

  // ---- push/wake ----
  _maybeWake({ to, channel_id, from, id, content, type }) {
    if (type === "status") return; // never wake on activity noise
    const targets = new Set();
    if (to) targets.add(to);
    if (channel_id && channel_id !== ACTIVITY_CHANNEL) {
      for (const m of this.db.prepare(`SELECT agent_id FROM memberships WHERE channel_id=?`).all(channel_id)) {
        if (m.agent_id !== from) targets.add(m.agent_id);
      }
    }
    for (const agentId of targets) {
      if ((this.waiters.get(agentId) ?? 0) > 0) continue; // actively waiting — no wake needed
      if (this.pendingWakes.has(agentId)) continue; // already scheduled (debounce)
      const agent = this.db.prepare(`SELECT wake_url, wake_secret FROM agents WHERE id=?`).get(agentId);
      if (!agent || !agent.wake_url) continue;
      this.pendingWakes.add(agentId);
      const preview = String(content ?? "").slice(0, 200);
      setTimeout(() => {
        this.pendingWakes.delete(agentId);
        this._fireWake(agent.wake_url, { agent_id: agentId, from, channel_id: channel_id ?? null, message_id: id, preview, secret: agent.wake_secret ?? null });
      }, WAKE_DEBOUNCE_MS);
    }
  }

  _fireWake(url, body) {
    // Fire-and-forget. The message is already durable; a failed wake still delivers on next poll.
    Promise.resolve()
      .then(() => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
      .catch((err) => console.error("[agentbus] wake POST failed:", url, String(err)));
  }
}

function toMessage(r) {
  return {
    id: r.id,
    channel_id: r.channel_id,
    from: r.from_agent,
    to: r.to_agent,
    thread_id: r.thread_id,
    reply_to: r.reply_to,
    type: r.type,
    content: r.content,
    created_at: r.created_at,
  };
}

export const bus = new Bus();
