---
type: Runbook
title: Local Development
description: Prerequisites, running the whole stack in Docker or each service individually, seeding data, and every port the system uses.
resource: Makefile
tags: [operations, development, setup, runbook]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/getting-started.md
    author: human:maxrg
    last_modified: 2026-07-25
---

# Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Rust | stable, edition 2021 | backend |
| PostgreSQL | 17, via Docker | backend |
| NATS | 2.x with JetStream, via Docker | async planning |
| Python | ≥ 3.11 | optimizer, agent |
| uv | latest | Python dependency management |
| Node.js | 20+ | Angular UI |
| Docker + Compose | recent | infrastructure and full-stack runs |

# Whole stack in Docker

```bash
docker network create backend
docker network create dev_backend
cp deploy/.env.example deploy/.env   # fill in LLM keys, Keycloak URLs
cd deploy && make up
```

Brings up PostgreSQL, NATS, backend, optimizer, UI, agent, MCP, n8n and APISIX.

**Two stale Makefile targets.** The root `Makefile` still refers to
`dev/docker-compose.yml` (`make db-up`, `make db-down`) and
`ui/deploy/docker-compose.yml` (part of `make up` / `make down`). Neither file
exists in the repository. Use `docker compose -f deploy/docker-compose.yml …`
directly until those targets are fixed.

# Piece by piece

**1. Infrastructure**

```bash
docker compose -f deploy/docker-compose.yml up -d postgres nats
```

**2. Backend** — migrations are embedded and applied at startup; nothing to run by
hand.

```bash
export DATABASE_URL=postgresql://shift_user:shift_password@localhost:5432/shift
make serve PORT=8081 DEV=1 TENANT_ID=0
curl http://localhost:8081/health
curl http://localhost:8081/api/v1/shifts
```

`DEV=1` sets `--dev-mode`, pinning every request to `TENANT_ID` instead of
resolving a tenant from a JWT. That is what makes the API usable with plain `curl`
and no gateway — and why it must never leave a development machine. See
[Tenant](/concepts/tenant.md).

**3. Seed data**

```bash
make seed                                        # defaults to :8081
make seed SEED_URL=http://127.0.0.1:8080/api/v1
make dev-run                                     # serve + seed together
```

`seed_data_v2.py` drives the public REST API, so it works against any reachable
instance.

**4. Optimizer**

```bash
cd planner && make install
make nats     # JetStream subscriber — what the backend actually talks to
make api      # or Flask REST on :8888 for request/response testing
make schedule # or solve input.json with no infrastructure at all
```

**5. Frontend**

```bash
cd ui && npm install && npm start   # :4200
```

`ui/proxy.conf.json` forwards `/api` to the backend, so no CORS setup is needed.

**6. Agent and MCP**

```bash
cd agent && make install && cp .env.example .env
make mcp-http    # :8900 — start this first
make api         # :8899
make chat        # or talk to it in the terminal
```

Outside Docker set `MCP_SERVER_URL=http://localhost:8900/mcp`.

# Common commands

| Backend | Optimizer | Agent | UI |
|---|---|---|---|
| `make build` | `make schedule` | `make chat` | `npm start` |
| `make release` | `make api` | `make api` | `npm run build` |
| `make check` | `make nats` | `make mcp` | |
| `make test` | `make test-api` | `make mcp-http` | |
| `make serve` | | `make mcp-token` | |
| `make seed`, `make dev-run` | | | |

# Ports

| Port | Service |
|---|---|
| 8080 | Backend default; 8081 via `deploy/docker-compose.yml` |
| 4200 | Angular dev server |
| 8888 | Optimizer REST API — and the UI container in Compose |
| 8899 | Agent chat API |
| 8900 | MCP server, HTTP transport |
| 5432 | PostgreSQL |
| 4222 / 8222 | NATS / NATS monitoring |
| 5678 | n8n |
| 80 / 443 | APISIX gateway |
| 9180 | APISIX admin API |

# Related

* [Backend configuration](/operations/backend-configuration.md)
* [Deployment and CI](/operations/deployment-and-ci.md)
