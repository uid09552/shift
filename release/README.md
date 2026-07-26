# Shift — Release deployment

Self-contained deployment bundle that runs the **published** images from the
GitLab container registry. Nothing is built here — for building, tagging and
pushing images see [`../deploy/Makefile`](../deploy/Makefile).

## Contents

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The application stack; every image reference is `${..._IMAGE}` |
| `.env.example` | Compose configuration template — images, ports, credentials |
| `agent.env.example` | Runtime configuration for the agent + MCP server |
| `nats/nats.conf` | NATS server config — JetStream + 10MB `max_payload` |
| `gateway/apisix_conf/apisix-standalone.yaml` | APISIX route table (OIDC, upstreams) |
| `gateway/apisix_conf/config-standalone.yaml` | APISIX node config (standalone/YAML mode, no etcd) |
| `iam/docker-compose.yml` | **Keycloak, deployed separately** — its own compose project |
| `iam/.env.example` | Keycloak configuration template |
| `iam/realm-shift.json.tpl` | Realm import template (realm, client, roles, admin user) |
| `iam/docker-entrypoint.sh` | Renders the template from env vars, then starts Keycloak |
| `Makefile` | `make init` / `pull` / `up` / `logs` / `down`, plus `iam-*` targets |

## Images

Only the four self-built services come from the project registry:

| Service | Image |
| --- | --- |
| `backend` | `registry.gitlab.com/uid09552/shift/backend:latest` |
| `planner` | `registry.gitlab.com/uid09552/shift/planner:latest` |
| `planner-ui` | `registry.gitlab.com/uid09552/shift/ui:latest` |
| `agent`, `mcp` | `registry.gitlab.com/uid09552/shift/agent:latest` |

`agent` and `mcp` deliberately share one image — same content, different
command. Everything else (Postgres, NATS, APISIX, n8n — and Keycloak in the
separate IAM project) comes from its upstream registry.

Pin real tags instead of `:latest` in `.env` for reproducible deployments.

## Quick start

```bash
docker network create backend      # once — both networks are external
docker network create dev_backend
make init                 # creates .env, agent.env and iam/.env from templates
$EDITOR .env              # set the database password and the ports
$EDITOR agent.env         # set the LLM provider and API key
$EDITOR iam/.env          # set the Keycloak credentials and client secret
docker login registry.gitlab.com   # only if the registry project is private
make pull
make up                   # application stack
make iam-up               # Keycloak, separate compose project
```

Then open <http://localhost/> — it redirects to `/planner/` and the gateway
sends you through Keycloak login (default realm user `admin` / the password in
`KEYCLOAK_REALM_ADMIN_PASSWORD`).

## Keycloak is deployed separately

Keycloak is **not** in the main `docker-compose.yml`. It runs as its own
compose project in [`iam/`](iam/) so the application stack can be redeployed
without touching realm, users and sessions. The two connect over shared docker
networks:

* Both projects attach to the **external** networks `backend` and
  `dev_backend` — the same ones `deploy/docker-compose.yml` uses, and not
  configurable. Create them once with `docker network create backend` and
  `docker network create dev_backend`; compose will not create them for you.
* The gateway routes `/auth/*` to the upstream `keycloak:8080` — the container
  must be resolvable under that name on the shared network. Running Keycloak on
  a different host instead? Change that upstream node in
  `gateway/apisix_conf/apisix-standalone.yaml`, and `KEYCLOAK_REALM_URL` /
  `KEYCLOAK_JWKS_URL` in `agent.env`.
* `PUBLIC_URL` must be identical in `.env` and `iam/.env` — it is Keycloak's
  issuer and must be how the browser reaches the gateway.

`make iam-up` / `iam-down` / `iam-logs` / `iam-ps` drive that project.

## Three env files, on purpose

* **`.env`** — read by docker compose itself: which images, which host ports,
  application database credentials. Compose picks this file up automatically
  because of its name.
* **`agent.env`** — mounted into the `agent` and `mcp` containers via
  `env_file`: LLM provider, model, API keys, MCP tool allowlist, backend and
  Keycloak URLs. It is *not* called `.env` so the two never get mixed up, and
  so compose never interpolates its values into the compose file.
* **`iam/.env`** — the separate Keycloak project's own compose configuration.

All three are git-ignored; only the `.example` templates are tracked.

## Routing

APISIX is the only service published to the host (ports `HTTP_PORT`/
`HTTPS_PORT`, default 80/443):

| Path | Upstream | Auth |
| --- | --- | --- |
| `/` | 302 → `/planner/` | — |
| `/auth/*` | `keycloak:8080` (separate IAM project) | none (IAM itself) |
| `/planner/*` | `planner-ui:80` | OIDC session (redirect to login) |
| `/images/*` | `planner-ui:80` | none |
| `/api/*` | `backend:8080` | bearer/session, `deny` when unauthenticated |
| `/agent/*` | `agent:8899` | same as `/api/*`; prefix rewritten to `/api/v1/*` |
| `/callback`, `/logout` | OIDC callback / session teardown | — |

## Values that are not in `.env`

APISIX's standalone YAML has no environment-variable interpolation, so three
things must be edited directly in
`gateway/apisix_conf/apisix-standalone.yaml` when going to production:

1. `client_secret:` — must equal `MCP_OAUTH_CLIENT_SECRET` in both `iam/.env`
   and `agent.env`.
2. `redirect_uri:` / `post_logout_redirect_uri:` — must sit under `PUBLIC_URL`.
3. `session.secret:` — signs the gateway session cookies; change it.

`PUBLIC_URL` also becomes Keycloak's issuer, so it must be exactly how the
browser reaches the stack. If you use a port other than 80, add that port to
`node_listen` in `config-standalone.yaml` as well: APISIX resolves the OIDC
discovery document through its own loopback listener.

## Keycloak realm bootstrap

On **first** start only (while the `keycloak_db_data` volume is empty), the
entrypoint renders `iam/realm-shift.json.tpl` — substituting `PUBLIC_URL`,
`MCP_OAUTH_CLIENT_SECRET`, `KEYCLOAK_REALM_ADMIN_USER` and
`KEYCLOAK_REALM_ADMIN_PASSWORD` — and Keycloak imports it, creating:

* realm `shift` with the `shift-org` organization-membership client scope,
* confidential client `shift-gateway` (used by APISIX and the MCP server),
* realm roles `shift-admin`, `shift-planner`, `shift-viewer`,
* the initial realm admin user.

Later changes to the template are **not** picked up — edit the realm in the
admin console (`${PUBLIC_URL}/auth/admin/`, or directly on
`http://localhost:${KEYCLOAK_HTTP_PORT}/auth/admin/`, master admin
`KEYCLOAK_ADMIN`), or drop the IAM volume to re-import:

```bash
docker compose -f iam/docker-compose.yml --env-file iam/.env down -v
make iam-up
```

The values are substituted into a JSON document, so avoid double quotes and
backslashes in them.

## Optional tooling

n8n is behind a compose profile and stays down by default:

```bash
make tools     # docker compose --profile tools up -d
```

## Data

This stack owns `postgres_data` (application data) and `n8n_data`; the IAM
project owns `keycloak_db_data` (realm, users, sessions). `make down` keeps
them, `make clean` deletes this stack's volumes — Keycloak's are untouched by
either.
