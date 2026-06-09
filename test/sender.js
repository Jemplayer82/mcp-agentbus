// Standalone sender: registers and sends one message.
// Usage: AGENTBUS_URL=... AGENTBUS_MCP_TOKEN=... node test/sender.js <to> "<message>"
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.AGENTBUS_URL ?? "http://192.168.7.50:3107/mcp";
const TOKEN = process.env.AGENTBUS_MCP_TOKEN;
const TO = process.argv[2] ?? "receiver";
const MSG = process.argv[3] ?? `ping ${Date.now()}`;
if (!TOKEN) { console.error("Set AGENTBUS_MCP_TOKEN"); process.exit(1); }

const transport = new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
const client = new Client({ name: "sender", version: "0" });
await client.connect(transport);
const call = (n, a = {}) => client.callTool({ name: n, arguments: a }).then((r) => JSON.parse(r.content[0].text));

await call("register_agent", { agent_id: "sender", name: "sender" });
const r = await call("send_message", { from: "sender", to: TO, content: MSG });
console.log(`[sender] -> ${TO}: ${MSG}  (message_id=${r.message_id})`);
await client.close();
