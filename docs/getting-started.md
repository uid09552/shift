# Getting Started

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Rust | stable (edition 2021) | backend |
| PostgreSQL | 17 (via Docker) | backend |
| NATS | 2.x with JetStream (via Docker) | async planning |
| Python | ≥ 3.11 | optimizer, agent |
| [uv](https://docs.astral.sh/uv/) | latest | Python dependency management |
| Node.js | 20+ | Angular UI |
| Docker + Compose | recent | infrastructure and full-stack runs |

## Fastest path: the whole stack in Docker

```bash
docker network create backend
docker network create dev_backend
cp deploy/.env.example deploy/.env   # fill in LLM keys, Keycloak URLs
make up                              # or: cd deploy && make up
```

This brings up PostgreSQL, NATS, the backend, the optimizer, the UI, the agent,
the MCP server, n8n and the APISIX gateway. Ports are listed under
[Deployment](deployment.md#compose-stack) and at the [bottom of this
page](#ports-at-a-glance).

## Running the pieces individually

### 1. Infrastructure

```bash
make db-up        # docker compose -f deploy/docker-compose.yml up -d postgres nats
```

PostgreSQL listens on `5432`, NATS on `4222` (monitoring on `8222`).

### 2. Backend

Migrations in `migrations/` are embedded and applied at startup, so there is
nothing to run by hand.

```bash
make serve PORT=8082 DEV=1 TENANT_ID=0
```

`config.yaml` already points at the Compose PostgreSQL
(`postgres:postgres@localhost:5432/shift`); set `DATABASE_URL` only for a
different database. Port 8082 is where the UI dev server's proxy
(`ui/proxy.conf.json`) sends `/api` — 8081 is taken by the backend container
when the whole Compose stack runs.

`DEV=1` sets `--dev-mode`, which pins every request to `TENANT_ID` instead of
resolving a tenant from a JWT — that is what makes the API usable with plain
`curl`, with no gateway in front. Never enable it outside development; see
[Auth & Multi-Tenancy](auth.md).

Check it:

```bash
curl http://localhost:8082/health
curl http://localhost:8082/api/v1/shifts
```

### 3. Seed data

```bash
make seed SEED_URL=http://127.0.0.1:8082/api/v1  # the backend started above
make seed                                        # default: :8081, the Compose backend
```

`seed_data_v2.py` drives the public REST API, so it works against any reachable
instance. `make dev-run` combines starting the server and seeding in one step.

### 4. Optimizer

```bash
cd planner
make install
make nats     # JetStream subscriber — what the backend actually talks to
# or
make api      # Flask REST API on :8888, for direct request/response testing
```

Solve a file without any infrastructure at all:

```bash
cd planner && make schedule    # input.json -> output.json
```

### 5. Frontend

```bash
cd ui && npm install && npm start   # ng serve on :4200
```

Open <http://localhost:4200/planner/>. `ui/proxy.conf.json` forwards `/api` to
the backend on :8082, so the dev server needs no CORS configuration.

### 6. Agent and MCP server

```bash
cd agent
make install
cp .env.example .env      # choose an LLM provider and model
make mcp-http             # MCP server on :8900 — start this first
make api                  # chat API on :8899
make chat                 # or talk to it in the terminal
```

Outside Docker, point the agent at your local MCP server with
`MCP_SERVER_URL=http://localhost:8900/mcp`.

## Common commands

=== "Backend"

    ```bash
    make build     # cargo build
    make release   # cargo build --release
    make check     # cargo check
    make test      # cargo test
    make serve     # PORT=… LISTEN=… VERBOSE=1 DEV=1 TENANT_ID=…
    make seed      # seed via the REST API
    make dev-run   # serve + seed together
    ```

=== "Optimizer"

    ```bash
    cd planner
    make schedule  # solve input.json
    make api       # Flask REST API :8888
    make nats      # JetStream subscriber
    make test-api  # smoke test
    ```

=== "Agent"

    ```bash
    cd agent
    make chat      # terminal chat
    make api       # chat API :8899
    make mcp       # MCP over stdio
    make mcp-http  # MCP over HTTP :8900
    make mcp-token # client-credentials token
    ```

=== "UI"

    ```bash
    cd ui
    npm start          # dev server :4200
    npm run build      # production build
    ```

## Ports at a glance

| Port | Service |
|---|---|
| 8080 | Backend (default); 8082 for local development behind the UI dev server; 8081 when run via `deploy/docker-compose.yml` |
| 4200 | Angular dev server |
| 8888 | Optimizer REST API — and the UI container in Compose |
| 8899 | Agent chat API |
| 8900 | MCP server (HTTP transport) |
| 5432 | PostgreSQL |
| 4222 / 8222 | NATS / NATS monitoring |
| 5678 | n8n |
| 80 / 443 | APISIX gateway |
| 9180 | APISIX admin API |
