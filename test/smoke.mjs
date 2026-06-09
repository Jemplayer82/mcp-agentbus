// Self-contained smoke test: boots the server, runs two MCP clients through a
// real-time round-trip + awareness feed, asserts, exits 0 (pass) / 1 (fail).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { createServer as netCreateServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const __dir = dirname(fileURLToPath(import.meta.url));
// Grab a guaranteed-free ephemeral port (Windows reserves chunks of the low range).
const PORT = await new Promise((res) => {
  const s = netCreateServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
const TOKEN = "smoke-token";
const DB = join(tmpdir(), `agentbus-smoke-${process.pid}.db`);
const URL_ = `http://127.0.0.1:${PORT}/mcp`;

const cleanupDb = () => { for (const s of ["", "-wal", "-shm"]) try { rmSync(DB + s); } catch {} };
cleanupDb();

const child = spawn(process.execPath, [join(__dir, "..", "server.js")], {
  env: { ...process.env, PORT: String(PORT), AGENTBUS_MCP_TOKEN: TOKEN, AGENTBUS_DB_PATH: DB },
  stdio: ["ignore", "inherit", "inherit"],
});

let failed = false;
const assert = (cond, msg) => { if (!cond) { failed = true; console.error("  ✗ " + msg); } else console.log("  ✓ " + msg); };
const parse = (r) => JSON.parse(r.content[0].text);

async function waitHealthz() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy");
}

async function mkClient(name) {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
  const client = new Client({ name, version: "0" });
  await client.connect(transport);
  return client;
}
const call = (c, name, args = {}) => c.callTool({ name, arguments: args }).then(parse);

try {
  await waitHealthz();
  console.log("server healthy");

  const recv = await mkClient("receiver");
  const send = await mkClient("sender");

  await call(recv, "register_agent", { agent_id: "receiver", name: "Receiver" });
  await call(send, "register_agent", { agent_id: "sender", name: "Sender" });

  // --- auth rejection ---
  const bad = new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: "Bearer wrong" } } });
  let rejected = false;
  try { const c = new Client({ name: "bad", version: "0" }); await c.connect(bad); } catch { rejected = true; }
  assert(rejected, "wrong bearer token is rejected (401)");

  // --- real-time direct message ---
  const stamp = Date.now();
  const waitP = call(recv, "wait_for_message", { agent_id: "receiver", timeout_seconds: 10 });
  await new Promise((r) => setTimeout(r, 150)); // ensure receiver is parked in long-poll
  await call(send, "send_message", { from: "sender", to: "receiver", content: `ping ${stamp}` });
  const got = await waitP;
  const latency = Date.now() - stamp;
  assert(!got.timed_out && got.messages.length === 1, "direct message delivered via long-poll");
  assert(got.messages[0].content === `ping ${stamp}`, "message content intact");
  assert(latency < 1000, `delivered in <1s (was ${latency}ms)`);

  // --- backlog/drain: send before waiting, no redelivery ---
  await call(send, "send_message", { from: "sender", to: "receiver", content: "backlog-1" });
  const drain1 = await call(recv, "wait_for_message", { agent_id: "receiver", timeout_seconds: 5 });
  assert(drain1.messages.length === 1 && drain1.messages[0].content === "backlog-1", "backlog drained on next wait");
  const drain2 = await call(recv, "wait_for_message", { agent_id: "receiver", timeout_seconds: 1 });
  assert(drain2.timed_out, "no redelivery — cursor advanced (clean timeout)");

  // --- channel broadcast ---
  await call(recv, "join_channel", { agent_id: "receiver", channel_id: "general" });
  await call(send, "send_message", { from: "sender", channel_id: "general", content: "hello channel" });
  const ch = await call(recv, "wait_for_message", { agent_id: "receiver", timeout_seconds: 5 });
  assert(ch.messages.some((m) => m.content === "hello channel"), "channel broadcast received by member");

  // --- coordination: instruction/result thread ---
  const instr = await call(send, "send_message", { from: "sender", to: "receiver", type: "instruction", thread_id: "t1", content: "do X" });
  await call(recv, "wait_for_message", { agent_id: "receiver", timeout_seconds: 5 });
  await call(recv, "send_message", { from: "receiver", to: "sender", type: "result", thread_id: "t1", reply_to: instr.message_id, content: "done X" });
  const result = await call(send, "wait_for_message", { agent_id: "sender", timeout_seconds: 5 });
  assert(result.messages.some((m) => m.type === "result" && m.reply_to === instr.message_id), "instruction→result round-trip with reply_to");

  // --- presence ---
  const agents = await call(recv, "list_agents");
  assert(agents.agents.find((a) => a.id === "receiver")?.online === true, "presence: receiver online");

  // --- awareness feed ---
  await call(send, "set_status", { agent_id: "sender", activity: "running smoke test", detail: "phase 2" });
  const act = await call(recv, "get_activity", {});
  assert(act.feed.some((m) => m.from === "sender"), "activity feed carries sender's status");
  assert(act.agents.find((a) => a.id === "sender")?.last_activity === "running smoke test", "agent snapshot shows current activity");

  await recv.close();
  await send.close();
} catch (err) {
  failed = true;
  console.error("smoke test threw:", err);
} finally {
  child.kill();
  cleanupDb();
  console.log(failed ? "\nSMOKE: FAIL" : "\nSMOKE: PASS");
  process.exit(failed ? 1 : 0);
}
