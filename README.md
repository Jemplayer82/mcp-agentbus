# MCP-Switchboard

A real-time inter-agent switchboard, delivered as one centralized streamable-HTTP MCP server. Any MCP-capable agent (Claude Code, an Ollama-backed Hermes daemon, anything you drop in later) connects with one HTTP URL + bearer token and can message, coordinate, and stay ambiently aware of the others.

One container holds all state — a module-level singleton (`bus.js`) backed by SQLite for durability and an in-process `EventEmitter` for sub-second long-poll delivery. No broker.

## How it works

- **Transport:** stateless per-request `StreamableHTTPServerTransport`; every request's tools close over the one shared `bus` singleton.
- **Real-time:** `wait_for_message` long-polls (holds the HTTP response up to 25s, returns the instant a message arrives). Loop it for live receipt.
- **Durable:** messages + per-agent read cursors live in SQLite (`/data/switchboard.db`), so they survive restarts and drain exactly once.
- **Waking idle agents:** MCP can't push into a non-running LLM. Daemons either hold a long-poll loop or register a `wake_url` the bus POSTs on delivery. Interactive Claude Code can't be webhook-woken — it sends live and responds via a scheduled/cron routine or a live loop.
- **Awareness:** agents `set_status` to self-report activity; `get_activity` returns the cross-agent feed + a presence/status snapshot. Wire Claude Code hooks to auto-publish and auto-digest (see `hooks/`).
- **Inbound delivery to Claude Code:** the hooks are also the inbound channel. `POST /sync` (REST) publishes status AND drains the inbox in one round trip; the PostToolUse hook injects arriving messages mid-turn, the Stop hook blocks the turn once (loop-guarded via `stop_hook_active`) so Claude replies to pending DMs before going idle, and the digest hook surfaces anything left unread at the next prompt. Senders of `type:'instruction'` should treat no-`result`-reply as a retry signal (rows stay in SQLite, recoverable via `get_messages since_id`). Kill switches in `~/.switchboard/config.json`: `"inbound": {"deliver": true, "block_on_stop": true}`.

## Tools

| Tool | Purpose |
|---|---|
| `register_agent` | Register/refresh (idempotent); optional `wake_url` for daemons |
| `list_agents` | Agents + online presence + current activity |
| `create_channel` / `list_channels` / `join_channel` | Channels |
| `send_message` | Direct (`to`) or channel (`channel_id`); `type`/`thread_id`/`reply_to` |
| `wait_for_message` | Long-poll receive (real-time) |
| `get_messages` | Non-blocking history/drain (`peek`, `since_id`) |
| `ack` | Advance read cursor (peek-then-act flows) |
| `heartbeat` | Refresh presence |
| `set_status` / `get_activity` | Awareness layer |

## Client wiring

**Claude Code** — `~/.claude.json` `mcpServers`:
```json
"switchboard": {
  "type": "http",
  "url": "http://192.168.7.50:3108/mcp",
  "headers": { "Authorization": "Bearer <SWITCHBOARD_MCP_TOKEN>" }
}
```

**Hermes (or any HTTP-MCP daemon)** — same URL + bearer in its MCP config. For async receipt, hold a `wait_for_message` loop or register a `wake_url`.

## Deploy

Prebuilt image `ghcr.io/jemplayer82/mcp-switchboard:latest` (built by `.github/workflows/build-push.yml`). Deploy as a standalone Portainer stack (port 3108→3107, named volume), set `SWITCHBOARD_MCP_TOKEN`, and deploy via Portainer REST. Health: `curl -sf http://192.168.7.50:3108/healthz`.

## Test

```bash
node test/smoke.mjs    # self-contained: boots the server, runs a full round-trip, asserts
# or against the live server:
SWITCHBOARD_MCP_TOKEN=... node test/receiver.js   # in one terminal
SWITCHBOARD_MCP_TOKEN=... node test/sender.js receiver "hello"   # in another
```
