---
type: Reference
title: Backend Configuration
description: The four Figment layers, every setting with its default, environment variable naming, CLI flags, and where solver configuration lives instead.
resource: src/config.rs
tags: [operations, configuration, figment, reference]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/configuration.md
    author: human:maxrg
    last_modified: 2026-07-25
  - resource: src/config.rs
    author: human:maxrg
    last_modified: 2026-07-10
---

Configured with [Figment](https://docs.rs/figment/), layering four sources. Later
layers win:

1. **Built-in defaults** — `Config::default()` in `src/config.rs`
2. **YAML file** — `config.yaml`, or wherever `CONFIG_PATH` points; skipped
   silently if absent
3. **Environment variables** — `SHIFT_`-prefixed first, then unprefixed
4. **CLI flags** — passed to `serve`

# Configuration file

```yaml
server:
  port: 8080
  listen: "127.0.0.1"
  verbose: false

database:
  url: "postgresql://postgres:postgres@localhost:5432/shift"

broker:
  host: "127.0.0.1"
  port: 4222

optimizer:
  url: "http://localhost:8888"
```

# All settings

**`server`** — `port` (8080), `listen` (`127.0.0.1`; use `0.0.0.0` in a
container), `verbose` (false).

**`database`** — `url`
(`postgresql://shift_user:shift_password@localhost:5432/shift`), plus discrete
`user`, `password`, `host`, `port`, `database`.

**`broker`** — `host` (`127.0.0.1`), `port` (4222). Without a reachable broker the
API still serves, but `POST /planner/plan` fails — there is nowhere to publish the
job.

**`optimizer`** — `url` (`http://localhost:8888`).

**`tenant`** — `dev_mode` (false), `tenant_id` (`"0"`).

**`dev_mode: true` disables tenant isolation.** Every unauthenticated request
operates on the configured tenant. It exists so the API is usable without a
gateway during development. Never enable it on a shared or production deployment —
see [Tenant isolation](/architecture/tenant-isolation.md).

# Environment variables

Figment reads `SHIFT_`-prefixed variables and unprefixed ones. Nested keys use a
dot or a double underscore:

```bash
export SHIFT_SERVER__PORT=9000
export SHIFT_DATABASE__URL=postgresql://user:pass@db:5432/shift
export SHIFT_BROKER__HOST=nats
export SHIFT_TENANT__DEV_MODE=true
export SHIFT_TENANT__TENANT_ID=acme
```

Because unprefixed variables are **also** merged, a bare `DATABASE_URL` in the
environment is picked up too. Convenient locally, and worth remembering when
debugging an unexpected connection string.

# CLI flags

```bash
cargo run -- serve --help
```

`--port`, `--listen`, `--verbose`/`-v`, `--database-url`, `--database-user`,
`--database-password`, `--database-host`, `--database-port`, `--database-name`,
`--broker-host`, `--broker-port`, `--optimizer-url`, `--dev-mode`, `--tenant-id`.

The `serve` Makefile target wraps these:

```bash
make serve PORT=8081 LISTEN=0.0.0.0 VERBOSE=1 DEV=1 TENANT_ID=0
```

# Solver configuration is elsewhere

Optimizer weights and limits are **not** in this file. They are stored per tenant
in `planner_settings` and edited through `GET`/`PUT /api/v1/planner-settings` or
the UI. The split is deliberate: deployment configuration is static and
per-installation; solver weights are dynamic and per-ward. See
[Planner settings reference](/solver/planner-settings-reference.md).

# Agent and optimizer environment

The Python services are configured entirely through environment variables, with
templates checked in:

* `agent/.env.example` — LLM provider and model, `MCP_SERVER_URL`, `MCP_TOOLS`,
  `BACKEND_API_URL`, Keycloak URLs, `MCP_OAUTH_CLIENT_ID`/`_SECRET`,
  `BACKEND_ACCESS_TOKEN`
* `deploy/.env.example` — everything the Compose stack needs

`.env` files are gitignored; only the `.example` templates are tracked. They hold
API keys and client secrets — keep it that way.
