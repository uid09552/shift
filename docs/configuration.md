# Configuration

The backend is configured with [Figment](https://docs.rs/figment/), which
layers four sources. Later layers win:

1. **Built-in defaults** — `Config::default()` in `src/config.rs`
2. **YAML file** — `config.yaml`, or whatever `CONFIG_PATH` points at; skipped
   silently if absent
3. **Environment variables** — `SHIFT_`-prefixed first, then unprefixed
4. **CLI flags** — passed to `serve`

## Configuration file

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

Point elsewhere with `CONFIG_PATH=/etc/shift/config.yaml`.

## All settings

### `server`

| Key | Default | Meaning |
|---|---|---|
| `port` | `8080` | Listen port |
| `listen` | `127.0.0.1` | Bind address — use `0.0.0.0` in a container |
| `verbose` | `false` | Verbose logging |

### `database`

| Key | Default |
|---|---|
| `url` | `postgresql://shift_user:shift_password@localhost:5432/shift` |
| `user` | `shift_user` |
| `password` | `shift_password` |
| `host` | `localhost` |
| `port` | `5432` |
| `database` | `shift` |

### `broker`

| Key | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | NATS host |
| `port` | `4222` | NATS port |

Without a reachable broker the API still serves, but `POST /planner/plan`
fails — there is nowhere to publish the job.

### `optimizer`

| Key | Default | Meaning |
|---|---|---|
| `url` | `http://localhost:8888` | Optimizer HTTP endpoint |

### `tenant`

| Key | Default | Meaning |
|---|---|---|
| `dev_mode` | `false` | Pin every request to `tenant_id` instead of reading a JWT |
| `tenant_id` | `"0"` | The tenant used in dev mode |

!!! danger "Dev mode disables tenant isolation"
    With `dev_mode: true`, every unauthenticated request operates on the
    configured tenant. It exists so the API is usable without a gateway during
    development. Never enable it on a shared or production deployment.

## Environment variables

Figment reads `SHIFT_`-prefixed variables and unprefixed ones. Nested keys use
a dot or a double underscore:

```bash
export SHIFT_SERVER__PORT=9000
export SHIFT_DATABASE__URL=postgresql://user:pass@db:5432/shift
export SHIFT_BROKER__HOST=nats
export SHIFT_TENANT__DEV_MODE=true
export SHIFT_TENANT__TENANT_ID=acme
```

Because unprefixed variables are also merged, a bare `DATABASE_URL` in the
environment is picked up too — convenient locally, and worth remembering when
debugging an unexpected connection string.

## CLI flags

```bash
cargo run -- serve --help
```

| Flag | Overrides |
|---|---|
| `--port` | `server.port` |
| `--listen` | `server.listen` |
| `--verbose` / `-v` | `server.verbose` |
| `--database-url` | `database.url` |
| `--database-user` | `database.user` |
| `--database-password` | `database.password` |
| `--database-host` | `database.host` |
| `--database-port` | `database.port` |
| `--database-name` | `database.database` |
| `--broker-host` | `broker.host` |
| `--broker-port` | `broker.port` |
| `--optimizer-url` | `optimizer.url` |
| `--dev-mode` | `tenant.dev_mode` |
| `--tenant-id` | `tenant.tenant_id` |

The `serve` Makefile target wraps these:

```bash
make serve PORT=8081 LISTEN=0.0.0.0 VERBOSE=1 DEV=1 TENANT_ID=0
```

## Solver configuration

Optimizer weights and limits are **not** part of this file — they are stored
per tenant in `planner_settings` and edited through
`GET`/`PUT /api/v1/planner-settings` or the UI's planner settings page. See
[Optimizer](planner.md#tunable-settings).

## Agent and optimizer environment

The Python services are configured entirely through environment variables, with
templates checked in:

- `agent/.env.example` — LLM provider and model, `MCP_SERVER_URL`, `MCP_TOOLS`,
  `BACKEND_API_URL`, Keycloak URLs, `MCP_OAUTH_CLIENT_ID` / `_SECRET`,
  `BACKEND_ACCESS_TOKEN`
- `deploy/.env.example` — everything the Compose stack needs

`.env` files are gitignored; only the `.example` templates are tracked. They
hold API keys and client secrets — keep it that way.
