// Standalone receiver: registers, then loops wait_for_message printing arrivals + latency.
// Usage: AGENTBUS_URL=http://192.168.7.50:3107/mcp AGENTBUS_MCP_TOKEN=... node test/receiver.js [agent_id]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.AGENTBUS_URL ?? "http://192.168.7.50:3107/mcp";
const TOKEN = process.env.AGENTBUS_MCP_TOKEN;
const AGENT = process.argv[2] ?? "receiver";
if (!TOKEN) { console.error("Set AGENTBUS_MCP_TOKEN"); process.exit(1); }

const transport = new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
const client = new Client({ name: AGENT, version: "0" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a }).then((r) => JSON.parse(r.content[0].text));

await call("register_agent", { agent_id: AGENT, name: AGENT });
console.log(`[${AGENT}] connected to ${URL_}, waiting for messages...`);

for (;;) {
  const r = await call("wait_for_message", { agent_id: AGENT, timeout_seconds: 20 });
  for (const m of r.messages) {
    const age = Date.now() - m.created_at;
    console.log(`[${AGENT}] <- ${m.from} (${m.type}, +${age}ms): ${m.content}`);
  }
}
