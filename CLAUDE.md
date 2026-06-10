<!-- GSD:project-start source:PROJECT.md -->
## Project

**MCP-Switchboard**

A real-time inter-agent switchboard delivered as one centralized streamable-HTTP MCP server. It lets any MCP-capable AI agent — this Claude Code instance, the Ollama-backed Hermes daemon on OpenClaw, and anything dropped in later — talk to each other, pass instructions, coordinate on projects, and stay ambiently aware of what the others are doing, all over the existing `mcp-shared` infrastructure.

**Core Value:** Two agents can exchange a message in real time (sub-second while a recipient is actively waiting) with zero per-agent custom plumbing — wiring a new agent in is one HTTP MCP config line.

### Constraints

- **Tech stack**: Node 22 ESM, `@modelcontextprotocol/sdk ^1.15.0`, `better-sqlite3`, `zod` — match existing `mcp-shared` servers.
- **Deployment**: Prebuilt `ghcr.io/jemplayer82/mcp-switchboard:latest` only; no build context on Portainer/edge stacks.
- **Topology**: Exactly one container (single-writer SQLite + in-process long-poll waiters).
- **Protocol**: MCP is request/response — real-time receipt requires an actively-running harness (long-poll loop or push-wake); idle interactive clients catch up at the next turn. For interactive Claude Code, the hooks deliver inbound: `POST /sync` drains the inbox on every PostToolUse (mid-turn injection), the Stop hook blocks once so pending DMs get answered before idle, and the digest covers idle catch-up.
- **Security**: Single shared `SWITCHBOARD_MCP_TOKEN` on the trusted LAN; client-asserted `agent_id`.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
