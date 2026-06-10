// Claude Code PostToolUse/Stop hook → publishes this agent's activity AND delivers
// inbound switchboard messages into the session:
//   - PostToolUse: drained messages are injected as additionalContext (mid-turn delivery).
//   - Stop: pending DIRECT messages block the stop once so Claude replies before idling
//     (stop_hook_active guards against loops; channel chatter never blocks).
// Fire-and-forget, 1.5s timeout, silent exit(0) on any failure — never blocks the session.
// Reads ~/.switchboard/config.json: { base, token, agent_id, inbound?: { deliver, block_on_stop } }.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const quit = () => process.exit(0);
let cfg;
try {
  cfg = JSON.parse(readFileSync(join(homedir(), ".switchboard", "config.json"), "utf8"));
} catch {
  quit(); // no config → no-op
}
const inbound = { deliver: true, block_on_stop: true, ...(cfg.inbound ?? {}) };

const MAX_CONTEXT_CHARS = 4000;
const MAX_MSG_CHARS = 1500;

function fmt(messages) {
  const lines = [
    "Inbound switchboard messages (already marked read — they will NOT reappear):",
  ];
  let used = lines[0].length;
  let shown = 0;
  for (const m of messages) {
    const dest = m.to ?? `#${m.channel_id}`;
    const markers = [m.thread_id ? `thread:${m.thread_id}` : null, m.reply_to ? `reply_to:${m.reply_to}` : null]
      .filter(Boolean)
      .join(" ");
    const content = String(m.content ?? "").slice(0, MAX_MSG_CHARS);
    const line = `[#${m.id}] ${m.from} -> ${dest} (${m.type}${markers ? " " + markers : ""}): ${content}`;
    if (used + line.length > MAX_CONTEXT_CHARS) {
      lines.push(`…and ${messages.length - shown} more — use mcp__switchboard__get_messages to fetch them.`);
      break;
    }
    lines.push(line);
    used += line.length;
    shown++;
  }
  lines.push(
    `Reply via mcp__switchboard__send_message (from:'${cfg.agent_id}', use reply_to/thread_id to keep the conversation threaded). ` +
      "If a message concerns a different project than your cwd, reply saying which session should handle it rather than silently ignoring it."
  );
  return lines.join("\n");
}

async function postSync(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(`${cfg.base}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (r.ok) return await r.json();
    // /sync not deployed yet (or rolled back) — fall back to the legacy status-only POST.
    if (body.activity) {
      await fetch(`${cfg.base}/status`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({ agent_id: body.agent_id, activity: body.activity, detail: body.detail }),
        signal: ctrl.signal,
      }).catch(() => {});
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch {}
  const event = payload.hook_event_name || "";
  const tool = payload.tool_name || "";
  const proj = basename(payload.cwd || "") || "unknown";

  if (event === "Stop") {
    if (payload.stop_hook_active) {
      // Continuation caused by our own prior block — presence ping only, never block
      // again this turn. peek leaves any new arrivals unread for the next digest.
      await postSync({ agent_id: cfg.agent_id, activity: `[${proj}] idle (finished turn)`, peek: true, limit: 1 });
      quit();
    }
    const r = await postSync({ agent_id: cfg.agent_id, activity: `[${proj}] idle (finished turn)`, dm_only: true });
    const dms = (r?.messages ?? []).filter((m) => m.to === cfg.agent_id);
    if (inbound.block_on_stop && dms.length) {
      process.stdout.write(
        JSON.stringify({
          decision: "block",
          reason:
            fmt(dms) +
            "\nRespond now via mcp__switchboard__send_message, then stop. If no reply is warranted, just stop.",
        })
      );
    } else if (dms.length) {
      // Blocking disabled — still surface what we drained so it isn't lost.
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: fmt(dms) } }));
    }
    quit();
  }

  // PostToolUse (and anything else): publish activity + pick up the full inbox.
  let activity = tool ? `[${proj}] using ${tool}` : `[${proj}] working`;
  let detail;
  const fp = payload.tool_input?.file_path || payload.tool_input?.path;
  if (fp) detail = String(fp);
  const r = await postSync({ agent_id: cfg.agent_id, activity, detail });
  const messages = r?.messages ?? [];
  if (inbound.deliver && messages.length) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: event || "PostToolUse", additionalContext: fmt(messages) } })
    );
  }
  quit();
});
