# mcp-switchboard

## What This Is

A real-time inter-agent switchboard delivered as one centralized streamable-HTTP MCP server. It lets any MCP-capable AI agent — this Claude Code instance, the Ollama-backed Hermes daemon on OpenClaw, and anything dropped in later — talk to each other, pass instructions, coordinate on projects, and stay ambiently aware of what the others are doing, all over the existing `mcp-shared` infrastructure. As of v1.1 it sits — alongside a Playwright web-scraper MCP — behind a single supergateway endpoint, so every agent reaches every MCP server through one host:port.

## Core Value

Two agents can exchange a message in real time (sub-second while a recipient is actively waiting) with zero per-agent custom plumbing — wiring a new agent in is one HTTP MCP config line.

## Current Milestone: v1.1 Supergateway Fronting + Playwright Scraper

**Goal:** Put every MCP server behind one supergateway on the Web Server (`192.168.7.50:8000`) so all agents reach them via a single host:port, and add browser scraping by wrapping Microsoft's official `@playwright/mcp` behind that gateway.

**Target features:**
- Supergateway on `:8000` path-routes inbound MCP to ≥2 backends (switchboard + scraper); one host:port for everything, prebuilt/config-only stack
- Switchboard reachable behind the gateway at a stable path with bearer auth preserved; redeployed from current `main` to clear the stale-build drift
- Playwright web scraper: `@playwright/mcp` wrapped as streamable-HTTP behind the gateway, browsers baked into the image
- Clients (Claude Code + others) rewired to the gateway endpoints — adding an agent stays one config line
- Planning/deployment drift reconciled (mcp-agentbus→mcp-switchboard, retire dead `agentbus` stack id 63 / `:3108` references)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Any MCP-capable agent connects via one HTTP URL + bearer token (no per-agent bridge)
- [ ] Real-time direct + channel messaging with durable, restart-surviving delivery
- [ ] Long-poll receive so an actively-waiting agent gets messages in <1s
- [ ] Structured coordination (instruction/result, threads, peek+ack) on the same primitives
- [ ] Presence + push-wake so always-on daemons auto-respond without manual poking
- [ ] Ambient awareness layer — agents self-publish activity and auto-pull a digest so they track each other without the user relaying
- [ ] Deployed into the `mcp-shared` Portainer stack and wired to Claude Code + Hermes
- [ ] (v1.1) One supergateway on `:8000` fronts every MCP server via path routing — switchboard + scraper reachable at one host:port
- [ ] (v1.1) Playwright web scraper (`@playwright/mcp`) wrapped as HTTP behind the gateway — agents navigate + extract page content over MCP
- [ ] (v1.1) Switchboard redeployed from `main` behind the gateway; clients rewired to gateway endpoints; planning/deploy drift reconciled

### Out of Scope

- Separate broker (Redis/NATS/RabbitMQ) — one centralized MCP server holds shared state; a broker adds a container and failure mode for no benefit at this scale
- Multi-replica/horizontal scale — single-writer SQLite + in-process EventEmitter assume exactly one container
- Waking an idle interactive Claude session mid-idle — impossible over MCP; an LLM not executing can't perceive anything (mitigated by turn-boundary digest hooks, not solved)
- Per-agent auth tokens (v1 uses one shared token on the trusted LAN; additive upgrade later)

## Context

- **Infra:** A `mcp-shared` Portainer stack on the WebServer (LAN `192.168.7.50`, Portainer endpoint 3) hosts streamable-HTTP MCP servers at `192.168.7.50:31xx/mcp`. A Tailscale subnet router exposes the whole home LAN, so `192.168.x.x` is reachable from every agent host including cross-subnet OpenClaw.
- **Gateway (v1.1 target):** A supergateway endpoint on `192.168.7.50:8000` is the new single front door — it path-routes inbound MCP to the backend servers (switchboard, scraper) so clients use one host:port. As of milestone start `:8000` answers but has nothing mounted (bare `text/plain` 404 on all paths). The pre-v1.1 switchboard runs standalone on host `:3108`→container `:3107` (stale build: missing the phase-4 `/status`,`/activity`,`/healthz` routes), and the old Portainer stack `agentbus` (id 63) is gone — both to be reconciled this milestone.
- **Clients:** Claude Code connects via `.claude.json` `type:http` entries; Hermes (Ollama daemon on OpenClaw) takes HTTP MCP URLs directly. Both wire identically — no stdio bridge.
- **Conventions (verified against existing repos):** vanilla ES-module Node + `@modelcontextprotocol/sdk` + `StreamableHTTPServerTransport`, Bearer auth at the HTTP layer, `/healthz`, prebuilt images to `ghcr.io/jemplayer82/*` via GitHub Actions (never `build:` in compose), deploy via Portainer REST resupplying the full Env array (the redacted-`Env:[]` wipe gotcha).
- **Reference repos:** `gsd-browser-mcp` (server shell), `schwab-mcp` (stateless transport), `mcp-orchestrator/app/deploy/portainer.py` (deploy).
- Full approved design: `C:\Users\Landon\.claude\plans\ok-so-write-an-federated-map.md`.

## Constraints

- **Tech stack**: Node 22 ESM, `@modelcontextprotocol/sdk ^1.15.0`, `better-sqlite3`, `zod` — match existing `mcp-shared` servers.
- **Deployment**: Prebuilt `ghcr.io/jemplayer82/mcp-switchboard:latest` only; no build context on Portainer/edge stacks. The scraper and gateway likewise deploy as prebuilt/config-only stacks (no `build:`).
- **Topology**: Exactly one switchboard container (single-writer SQLite + in-process long-poll waiters). The gateway and scraper are separate containers; the gateway is the only port the LAN needs to reach.
- **Protocol**: MCP is request/response — real-time receipt requires an actively-running harness (long-poll loop or push-wake); idle interactive clients catch up at the next turn.
- **Security**: Single shared `SWITCHBOARD_MCP_TOKEN` on the trusted LAN; client-asserted `agent_id`. Open question for v1.1: gateway terminates auth vs. passes the bearer through to each backend.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One centralized HTTP MCP server = the bus (no broker) | Centralizing makes shared state automatic; a broker adds a container for zero benefit at this scale | — Pending |
| Long-poll `wait_for_message` as the real-time primitive | MCP can't push to an idle LLM; a held HTTP response is the robust lowest-common-denominator | — Pending |
| Stateless per-request transport + module-level singleton bus | Matches existing repos; singleton shares state across transient server instances | — Pending |
| `better-sqlite3` over experimental `node:sqlite` | Synchronous, proven, single-writer-safe with WAL | — Pending |
| LAN addressing (`192.168.7.50:3107`) not Tailscale `100.x` | Subnet router exposes the LAN; avoids Windows hairpin-NAT issues | — Pending |
| Single shared bearer token | Matches every other `mcp-shared` server; trusted LAN | — Pending |
| (v1.1) One supergateway on `:8000` fronts all MCP servers via path routing | Single host:port for clients; new backends mount without new ports/firewall holes; matches the existing `mcp-orchestrator` supergateway pattern | — Pending |
| (v1.1) Scraper = wrap official `@playwright/mcp`, not a bespoke build | Maintained upstream, full browser tool surface for free; we own only the container/wiring, not scraping logic | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-11 — milestone v1.1 (Supergateway Fronting + Playwright Scraper) started*
