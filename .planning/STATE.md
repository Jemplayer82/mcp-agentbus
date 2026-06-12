---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Supergateway Fronting + Playwright Scraper
status: planning
last_updated: "2026-06-12T02:49:12.065Z"
last_activity: 2026-06-12
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-09)

**Core value:** Two agents exchange a message in real time (sub-second while a recipient is actively waiting) with zero per-agent custom plumbing — wiring a new agent is one HTTP MCP config line.
**Current focus:** Phase 5 — final verification (Claude↔Hermes) — blocked on Hermes wiring (OpenClaw host)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-12 — Milestone v1.1 started

### Built & verified

- Phase 1-2 (Bus Core + Presence/Wake/Awareness): server.js/bus.js/tools.js/schema.sql — 12 MCP tools + REST /status,/activity. Smoke test green (<1s delivery, drain, no-redelivery, channels, instruction→result, presence, activity).
- Phase 3 (Ship): ghcr.io/jemplayer82/mcp-agentbus:latest via CI; deployed as STANDALONE Portainer stack (deviation from "merge into mcp-shared" — chosen for zero blast radius on the 9-service production stack; reversible). Live /healthz ok, durability proven across container recreate.
- Phase 4 (Wire + hooks): Claude Code .claude.json entry added (backup at C:/tmp/claude.json.backup-*); awareness hooks merged into ~/.claude/settings.json (backup at C:/tmp/claude-settings.backup-*); ~/.agentbus/config.json written. Hooks tested live. **Takes effect on next Claude Code restart.**
- Port note: 3107 was taken by mcp-home-assistant → host 3108.
- Token: C:/tmp/agentbus-token.txt (also in .claude.json + ~/.agentbus/config.json). NOT committed.

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- One centralized HTTP MCP server = the bus (no broker) — shared state is automatic
- Long-poll `wait_for_message` is the real-time primitive (MCP can't push to an idle LLM)
- Stateless per-request transport + module-level singleton bus (matches existing repos)
- `better-sqlite3` over experimental `node:sqlite` — synchronous, single-writer-safe with WAL
- LAN addressing `192.168.7.50:3107`, single shared `AGENTBUS_MCP_TOKEN`

### Pending Todos

None yet.

### Blockers/Concerns

- **[Phase 4/5 — ACTIVE BOUNDARY] Hermes wiring is the user's step.** Hermes runs on the OpenClaw host (192.168.1.19); its MCP config is NOT in the local `~/.openclaw/openclaw.json` (zero `mcp` keys — `tools` is just `{profile:messaging}`). I have no access to that host (shared-infra SSH was classifier-blocked). Add to Hermes' MCP config: HTTP server `agentbus` → `http://192.168.7.50:3108/mcp` with `Authorization: Bearer <token from C:/tmp/agentbus-token.txt>`. For async receipt give Hermes a persistent `wait_for_message` loop, or a `wake_url` pointing at OpenClaw's run-trigger endpoint. Once wired, VERIFY-02 (Claude↔Hermes round-trip) can run.
- [Phase 2/4] `wake_url` push depends on OpenClaw exposing a reachable run-trigger endpoint. If none exists, Hermes falls back to a persistent long-poll loop. Confirm exact path during wiring.
- [Phase 4] Claude Code cannot be webhook-woken (no inbound endpoint). Its async path is a scheduled/cron headless routine or a live `wait_for_message` loop — do NOT register a `wake_url` for Claude.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-09
Stopped at: Roadmap and STATE created; REQUIREMENTS traceability updated
Resume file: None
