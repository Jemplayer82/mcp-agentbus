# mcp-store

> **A self-hosted app store for [Model Context Protocol](https://modelcontextprotocol.io) servers.**
> Browse a curated catalog, fill in your secrets, click Deploy — no YAML required.

![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.12-009688?style=flat-square&logo=fastapi)
![Docker](https://img.shields.io/badge/Deploy-Docker_%2F_Portainer-2496ED?style=flat-square&logo=docker)
![Catalog](https://img.shields.io/badge/Catalog-21%2B_servers-00d4aa?style=flat-square)
![Transport](https://img.shields.io/badge/Transport-streamableHttp-6e40c9?style=flat-square)

---

## What is it

MCP Store is a lightweight web app that turns deploying MCP servers into a point-and-click operation. Instead of hand-editing `docker-compose.yml` files, you open a browser, pick the servers you need from the catalog, paste your API keys, and click **Deploy**.

The orchestrator generates a compose stack and pushes it to Docker directly or through Portainer — secrets never touch a config file.

<img width="800" height="300" alt="architecture" src="https://github.com/user-attachments/assets/4cde5ad8-782d-4fda-8248-ceb11c86373a" />

---

## How it works

### 1 — Catalog loads from YAML

`catalog/catalog.yaml` defines every available server — its name, category, Docker image or npx package, required env keys, and docs link. `catalog.py` parses it into Pydantic models at startup. No database needed.

### 2 — UI renders the catalog & checks installed state

The SPA calls `/api/catalog` then `/api/installed`, which introspects the live Portainer/Docker stack to show which servers are already running. Cards render with category tags, secret input fields, and docs links.

### 3 — You check boxes, fill secrets, click Deploy

Selected server IDs plus env values are POSTed to `/api/deploy`. Secrets travel only from browser → `localhost:8090` → Docker/Portainer. They are never written to disk unless you explicitly opt in.

### 4 — composegen.py builds the stack

Each entry is resolved to a service definition:

| Entry type | How it runs |
|---|---|
| `supergateway-npx` | Wraps any `npx` package behind [supergateway](https://github.com/supercorp-ai/supergateway) on the streamableHttp transport |
| `image` | Pulls a prebuilt `ghcr.io` image directly |
| `build` | Clones a GitHub repo and builds the image on your Docker host |

Ports, volumes, and `shm_size` are applied per spec. An nginx proxy can optionally front all services on the same network.

### 5 — Deploy adapter pushes the stack

**Docker socket:** the compose dict is applied via the Docker SDK directly on the host.

**Portainer adapter:** the YAML is posted to Portainer's REST API, creating or merging into a named stack on the target endpoint. Merge mode does a read-modify-write so existing services aren't pruned.

### 6 — Build-from-source (optional)

Paste any public GitHub URL under *Add Custom Server → GitHub URL*. The preview endpoint auto-detects a `Dockerfile` vs `package.json` and recommends the right deploy type. Click Deploy — the orchestrator clones and builds on your Docker host. Edge targets push the resulting image to a registry first.

---

## Catalog

21+ curated servers across 13 categories, defined in `catalog/catalog.yaml`. Each entry ships with env-key scaffolding — you fill in values, never the catalog.

| Category | Servers |
|---|---|
| `memory` | Memory (knowledge graph) |
| `reasoning` | Sequential Thinking |
| `ai` | Ollama · EverArt |
| `dev` | GitHub · GitLab · Sentry |
| `search` | SearXNG · Brave Search · Fetch |
| `storage` | Filesystem · Google Drive |
| `database` | PostgreSQL |
| `communication` | Slack |
| `productivity` | Linear · Notion · GSD Cloud Gateway |
| `browser` | GSD Browser · Puppeteer |
| `infrastructure` | Portainer MCP |
| `finance` | Schwab Trading |
| `home-automation` | Home Assistant |

---

## Install

### Option A — Docker Socket

Deploys MCP servers directly to this machine. Simplest setup, no extra tools needed.

```bash
docker run -d \
  --name mcp-store \
  -p 8090:8000 \
  -v mcp-store-data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/jemplayer82/mcp-orchestrator:latest
```

Open **http://localhost:8090** and deploy your first servers.

### Option B — Portainer API

Deploys to a remote host through Portainer's REST API. Your token stays server-side.

```bash
docker run -d \
  --name mcp-store \
  -p 8090:8000 \
  -v mcp-store-data:/data \
  ghcr.io/jemplayer82/mcp-orchestrator:latest
```

Open **http://localhost:8090** → *Deploy Target → Portainer API* → enter your URL, API token, and Endpoint ID → *Save Config*.

### docker-compose (recommended)

```bash
curl -O https://raw.githubusercontent.com/Jemplayer82/mcp-store/main/docker-compose.yml
docker compose up -d
```

<details>
<summary>docker-compose.yml</summary>

```yaml
version: "3.9"

services:
  mcp-store:
    image: ghcr.io/jemplayer82/mcp-orchestrator:latest
    container_name: mcp-store
    restart: unless-stopped
    ports:
      - "8090:8000"
    volumes:
      - orchestrator_data:/data
      # Uncomment for Docker socket mode:
      # - /var/run/docker.sock:/var/run/docker.sock
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  orchestrator_data:
```

</details>

---

## Custom servers

### Any npx package

Open *Add Custom Server → npx Package* and enter a package name or `github:owner/repo` spec. Works with anything that runs via `npx -y <package>`.

### Build from a GitHub URL

Paste any public GitHub repo URL under *Add Custom Server → GitHub URL*. The preview endpoint detects a `Dockerfile` or `package.json` and recommends the right deploy type automatically.

> ⚠️ Building from a GitHub URL runs that code on your Docker host. Only use sources you trust. A `_trust_confirmed=yes` env flag is required as an explicit acknowledgement.

### Save to My Catalog

Custom servers can be saved to your local catalog so they persist across sessions and appear in the main grid alongside official servers.

---

## Security

- **No secrets in the repo.** The catalog stores only env key names and labels — never values.
- **Portainer token stays server-side.** The SPA calls only `localhost:8090/api/*` — your token is never sent to the browser or logged.
- **Transient by default.** Secrets entered at deploy time are used once and discarded unless you explicitly opt in to persistence.
- **Docker socket warning.** Mounting `/var/run/docker.sock` gives the container host-level access. Use Portainer mode for a lower-privilege setup on remote hosts.
- **Build trust gate.** Deploying a `build`-type server requires `_trust_confirmed=yes` as a speed-bump against accidentally running untrusted code.

---

## Development

```bash
git clone https://github.com/Jemplayer82/mcp-store
cd mcp-store
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8090
```

Hot-reload with Docker:

```bash
docker compose -f docker-compose.dev.yml up
```

Run tests:

```bash
pytest tests/
```

### Adding a server to the catalog

Fork the repo, add an entry to `catalog/catalog.yaml`, open a PR. See [catalog/README.md](catalog/README.md) for the full schema and rules. Official entries must be type `supergateway-npx` or `image` — never `build`.

---

MIT License

<img width="800" height="300" alt="architecture" src="https://github.com/user-attachments/assets/4cde5ad8-782d-4fda-8248-ceb11c86373a" />
