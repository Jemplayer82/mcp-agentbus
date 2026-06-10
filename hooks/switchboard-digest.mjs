// Claude Code SessionStart/UserPromptSubmit hook → injects a digest of OTHER agents'
// recent activity PLUS any unread inbound messages, so this agent catches up the moment
// a turn starts — without the user relaying anything.
// Robust: fast timeout, silent no-op on any failure, falls back to the legacy /activity
// endpoint if /sync isn't deployed. Reads ~/.switchboard/config.json.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const quit = () => process.exit(0);
let cfg;
try {
  cfg = JSON.parse(readFileSync(join(homedir(), ".switchboard", "config.json"), "utf8"));
} catch {
  quit();
}

const MAX_MSG_CHARS = 1500;

function fmtInbox(messages) {
  const lines = ["Unread inbound switchboard messages (now marked read — they will NOT reappear):"];
  for (const m of messages.slice(0, 10)) {
    const dest = m.to ?? `#${m.channel_id}`;
    const markers = [m.thread_id ? `thread:${m.thread_id}` : null, m.reply_to ? `reply_to:${m.reply_to}` : null]
      .filter(Boolean)
      .join(" ");
    lines.push(`  [#${m.id}] ${m.from} -> ${dest} (${m.type}${markers ? " " + markers : ""}): ${String(m.content ?? "").slice(0, MAX_MSG_CHARS)}`);
  }
  if (messages.length > 10) lines.push(`  …and ${messages.length - 10} more — use mcp__switchboard__get_messages.`);
  lines.push(`  Reply via mcp__switchboard__send_message (from:'${cfg.agent_id}', use reply_to/thread_id).`);
  return lines.join("\n");
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch {}
  const event = payload.hook_event_name || "UserPromptSubmit";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    let data = null;
    let messages = [];
    const r = await fetch(`${cfg.base}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ agent_id: cfg.agent_id, include_activity: true }),
      signal: ctrl.signal,
    });
    if (r.ok) {
      data = await r.json();
      messages = data.messages ?? [];
    } else {
      // /sync not deployed — legacy awareness-only path.
      const r2 = await fetch(`${cfg.base}/activity?limit=20`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: ctrl.signal,
      });
      data = await r2.json();
    }
    const others = (data.agents || []).filter((a) => a.id !== cfg.agent_id);
    const online = others.filter((a) => a.online);
    if (!others.length && !messages.length) quit();
    const sections = [];
    if (messages.length) sections.push(fmtInbox(messages));
    if (others.length) {
      const lines = others.map((a) => {
        const act = a.last_activity ? `: ${a.last_activity}` : "";
        return `  - ${a.id} (${a.online ? "online" : "offline"})${act}`;
      });
      const recent = (data.feed || [])
        .filter((m) => m.from !== cfg.agent_id)
        .slice(-8)
        .map((m) => { try { return `  - ${m.from}: ${JSON.parse(m.content).activity}`; } catch { return `  - ${m.from}: ${m.content}`; } });
      sections.push(
        `Agent bus status (${online.length}/${others.length} other agents online):\n` +
          lines.join("\n") +
          (recent.length ? `\nRecent activity:\n${recent.join("\n")}` : "")
      );
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: sections.join("\n\n") } }));
  } catch {} finally {
    clearTimeout(timer);
    quit();
  }
});
