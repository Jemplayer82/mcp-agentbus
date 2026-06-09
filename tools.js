// tools.js — registers every agentbus tool over the shared bus singleton.
import { z } from "zod";

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (msg) => ({ content: [{ type: "text", text: String(msg) }], isError: true });

export function registerTools(server, bus) {
  server.registerTool(
    "register_agent",
    {
      description:
        "Register/refresh this agent on the bus (idempotent). Call on startup. `wake_url` (daemons only) is a harness HTTP endpoint the bus POSTs to wake an idle agent — do NOT set it for interactive Claude Code.",
      inputSchema: {
        agent_id: z.string().describe("Stable id, e.g. 'claude-code' or 'hermes'"),
        name: z.string(),
        capabilities: z.array(z.string()).optional(),
        wake_url: z.string().url().optional().describe("Daemon trigger endpoint; the bus POSTs here to wake the agent"),
        wake_secret: z.string().optional(),
      },
    },
    async (a) => ok(bus.registerAgent(a))
  );

  server.registerTool(
    "list_agents",
    { description: "List all known agents with presence (online if seen < 60s ago) and current activity.", inputSchema: {} },
    async () => ok({ agents: bus.listAgents() })
  );

  server.registerTool(
    "create_channel",
    { description: "Create a channel (idempotent).", inputSchema: { channel_id: z.string(), name: z.string().optional() } },
    async (a) => ok(bus.createChannel(a))
  );

  server.registerTool(
    "list_channels",
    { description: "List channels with member counts.", inputSchema: {} },
    async () => ok({ channels: bus.listChannels() })
  );

  server.registerTool(
    "join_channel",
    {
      description: "Join a channel. Cursor starts at the current head (no history flood).",
      inputSchema: { agent_id: z.string(), channel_id: z.string() },
    },
    async (a) => ok(bus.joinChannel(a))
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Send a direct message (`to`) or channel broadcast (`channel_id`) — exactly one. `type` (chat/instruction/result/ack), `thread_id`, and `reply_to` support structured coordination. Wakes any waiting recipient instantly.",
      inputSchema: {
        from: z.string(),
        to: z.string().optional().describe("Recipient agent id (direct message)"),
        channel_id: z.string().optional().describe("Channel id (broadcast)"),
        content: z.string(),
        type: z.string().optional(),
        thread_id: z.string().optional(),
        reply_to: z.number().optional(),
      },
    },
    async (a) => {
      if ((a.to == null) === (a.channel_id == null)) return fail("Provide exactly one of `to` or `channel_id`.");
      return ok({ ok: true, message_id: bus.send(a) });
    }
  );

  server.registerTool(
    "wait_for_message",
    {
      description:
        "Long-poll: blocks up to `timeout_seconds` (max 25, default 20) and returns the instant a message arrives, or `timed_out:true`. Drains the inbox. Loop this for real-time receipt.",
      inputSchema: {
        agent_id: z.string(),
        timeout_seconds: z.number().min(1).max(25).default(20),
      },
    },
    async (a, extra) => {
      const ms = Math.min(a.timeout_seconds ?? 20, 25) * 1000;
      const messages = await bus.waitForMessage(a.agent_id, ms, extra?.signal);
      return ok({ messages, timed_out: messages.length === 0 });
    }
  );

  server.registerTool(
    "get_messages",
    {
      description:
        "Non-blocking read. Default drains this agent's unread inbox. Pass `channel_id`/`since_id` for history (no cursor side-effects), or `peek:true` to read unread without advancing the cursor.",
      inputSchema: {
        agent_id: z.string(),
        channel_id: z.string().optional(),
        since_id: z.number().optional(),
        limit: z.number().max(200).default(50),
        peek: z.boolean().default(false),
        drain: z.boolean().default(true),
      },
    },
    async (a) => ok(bus.getMessages(a.agent_id, a))
  );

  server.registerTool(
    "ack",
    {
      description: "Advance this agent's read cursor up to `up_to_id` (for peek-then-act instruction flows).",
      inputSchema: { agent_id: z.string(), up_to_id: z.number() },
    },
    async (a) => ok(bus.ack(a.agent_id, a.up_to_id))
  );

  server.registerTool(
    "heartbeat",
    { description: "Refresh presence between polls; returns currently-online agents.", inputSchema: { agent_id: z.string() } },
    async (a) => ok(bus.heartbeat(a.agent_id))
  );

  server.registerTool(
    "set_status",
    {
      description:
        "Self-report current activity (awareness layer), e.g. activity='editing server.js'. Updates presence and emits a status event other agents see via get_activity.",
      inputSchema: { agent_id: z.string(), activity: z.string(), detail: z.string().optional() },
    },
    async (a) => ok(bus.setStatus(a))
  );

  server.registerTool(
    "get_activity",
    {
      description:
        "Read the cross-agent activity feed plus a snapshot of every agent's current status + online flag. The source for awareness digests.",
      inputSchema: { since_id: z.number().optional(), limit: z.number().max(200).default(50), agent_id: z.string().optional() },
    },
    async (a) => ok(bus.getActivity(a))
  );
}
