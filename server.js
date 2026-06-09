// server.js — node:http shell: Bearer auth at the HTTP layer, /healthz, and a
// stateless-per-request StreamableHTTP MCP transport over the shared bus singleton.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { bus } from "./bus.js";
import { registerTools } from "./tools.js";

const USER_TOKEN = process.env.AGENTBUS_MCP_TOKEN;
const PORT = Number(process.env.PORT ?? 3107);

if (!USER_TOKEN) {
  console.error("[agentbus] AGENTBUS_MCP_TOKEN is required");
  process.exit(1);
}

function extractBearer(header) {
  const m = (header || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function buildServer() {
  const server = new McpServer({ name: "agentbus", version: "0.1.0" }, { capabilities: { tools: {} } });
  registerTools(server, bus); // tools close over the module-level singleton
  return server;
}

const httpServer = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") return sendJson(res, 200, { ok: true });
    if (!req.url || !req.url.startsWith("/mcp")) return sendJson(res, 404, { error: "Not found" });
    if (extractBearer(req.headers.authorization) !== USER_TOKEN) return sendJson(res, 401, { error: "Unauthorized" });

    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Tear down the PER-REQUEST transport/server only. The `bus` singleton is never closed.
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);

    let body;
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON" });
        }
      }
    }
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("[agentbus] request error:", err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

httpServer.listen(PORT, "0.0.0.0", () => console.log(`[agentbus] listening on :${PORT}`));
