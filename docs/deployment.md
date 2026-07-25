# Deployment

Everything ships as container images built from `deploy/`, orchestrated with
Docker Compose and published to the GitLab container registry by CI.

## Images

| Image | Dockerfile | Contents |
|---|---|---|
| `backend` | `deploy/Dockerfile.backend` | Rust binary — `rust:1.88-bookworm` builder, `debian:bookworm-slim` runtime |
| `planner` | `deploy/Dockerfile.planner` | Python optimizer with OR-Tools |
| `ui` | `deploy/Dockerfile.ui` | Angular build served by nginx (`deploy/nginx.conf`) |
| `agent` | `deploy/Dockerfile.agent` | Chat agent **and** MCP server |

`mcp` is not a separate image: the Compose stack runs the `agent` image with a
different command, so there is one image to build, tag and push instead of two
identical ones.

All Dockerfiles `COPY` from the repository root, so the build context is the
root — not `deploy/`.

## Compose stack

`deploy/docker-compose.yml` brings up the whole system:

| Service | Container | Published port |
|---|---|---|
| `postgres` | `shift_postgres` | 5432 |
| `nats` | `shift_nats` | 4222, 8222 |
| `backend` | `shift_deploy_backend` | 8081 → 8080 |
| `planner` | `shift_deploy_planner` | — (NATS only) |
| `planner-ui` | `shift_planner_ui` | 8888 → 80 |
| `agent` | `shift_deploy_agent` | 8899 |
| `mcp` | `shift_deploy_mcp` | 8900 |
| `n8n` | `shift_n8n` | 5678 |
| `echo` | `shift_echo` | — (via gateway `/echo/*`) |
| `apisix` | `shift_apisix` | 80, 443, 9180, 9091, 9092 |

Two **external** networks are expected — create them before the first run:

```bash
docker network create backend
docker network create dev_backend
```

Then:

```bash
cp deploy/.env.example deploy/.env    # LLM keys, Keycloak URLs, secrets
cd deploy
make up        # docker-compose up -d
make ps
make logs
make down
make clean     # also removes volumes
```

Individual services: `make backend`, `make planner`, `make agent`, `make mcp`,
`make ui`, `make gateway`.

### Configuration

Agent and MCP settings come from `deploy/.env` (`env_file`), with two values
pinned in the Compose file itself because they depend on it:

- `MCP_SERVER_URL: http://mcp:8900/mcp` on the agent — the hostname is a
  Compose service name.
- `MCP_OAUTH_CLIENT_ID` / `_SECRET` blanked on `mcp` — the OIDC library needs an
  HTTPS issuer URL, which `MCP_BASE_URL` isn't here. See
  [Auth & Multi-Tenancy](auth.md#mcp-server-auth).

`.env` files are gitignored; only the `.example` templates are tracked.

## Identity provider

`deploy/iam/docker-compose.yml` runs Keycloak 26.2 with its own PostgreSQL,
importing `deploy/iam/realm-shift.json`. It is separate from the main stack so
the IdP can be brought up and torn down independently.

`deploy/gateway/` holds the APISIX configuration used in standalone mode, plus
mkcert certificates for local HTTPS on `lvh.me`.

## Registry

`deploy/Makefile` tags and pushes to `registry.gitlab.com/uid09552/shift` by
default:

```bash
make version                 # the tag that would be used
make tag                     # build + tag <registry>/<component>:<version> and :latest
make push                    # push the tags made by `make tag`
make push-all                # tag + push in one step
make push VERSION=1.2.3
make push-all REGISTRY=registry.example.com/other-project
```

`VERSION` defaults to `git describe --tags --always --dirty`, falling back to
`latest`.

## GitLab CI

### Runner requirements

Jobs are **untagged**, so any available instance runner picks them up. The build
job uses Docker-in-Docker, which requires a runner with `privileged = true`
under `[runners.docker]` in its `config.toml` — without it the dind service
cannot start and `docker info` fails with *"Cannot connect to the Docker
daemon"*.

To pin the pipeline to a specific runner, tag that runner and add a matching
`tags:` block to `.build` and `.mkdocs`.

The CLI and dind must agree on transport. `.build` pins both sides to plain TCP
(`DOCKER_TLS_CERTDIR: ""` with `DOCKER_HOST: tcp://docker:2375`), because
setting `DOCKER_TLS_CERTDIR` makes dind serve TLS on **2376 only** — a client
still pointed at 2375 then fails to connect. For TLS instead, set all four of
`DOCKER_TLS_CERTDIR: "/certs"`, `DOCKER_HOST: tcp://docker:2376`,
`DOCKER_TLS_VERIFY: 1` and `DOCKER_CERT_PATH: /certs/client`.

With a shell executor and a mounted Docker socket, drop `image:`, `services:`
and both `DOCKER_HOST` / `DOCKER_TLS_CERTDIR` variables instead.

### Container Registry must be enabled for the project

`CI_REGISTRY_IMAGE` is only defined when the **project's** Container Registry is
on (*Settings → General → Visibility, project features, permissions →
Container registry*). `CI_REGISTRY` is defined whenever the *instance* has a
registry — so `docker login` can succeed while `CI_REGISTRY_IMAGE` is still
empty, which produces an invalid tag like `/planner:abc1234`.

`.build` now derives the base from `$CI_REGISTRY/$CI_PROJECT_PATH` (lowercased,
since Docker references must be) when `CI_REGISTRY_IMAGE` is missing, and fails
with an explanatory message when neither is set. That keeps the tag valid, but
**pushes still require the project feature to be enabled** — the registry
rejects writes to a project that has it turned off.

### Build stage

`.build` runs as a `parallel: matrix` over `backend`, `planner`, `ui`, `agent`.
`before_script` polls for the daemon for ~60s before giving up, since dind
takes a few seconds to accept connections, and the job retries on
`runner_system_failure` / `stuck_or_timeout_failure` — the dind service is
occasionally reaped mid-pipeline.

Each job pulls `:latest` to warm the layer cache, builds with
`BUILDKIT_INLINE_CACHE=1` and `--cache-from`, and then:

| Pipeline | Result |
|---|---|
| Merge request | Image built, **not** pushed |
| Any branch | Push `:$CI_COMMIT_SHORT_SHA` |
| Default branch | Also push `:latest` |
| Tag | Also push `:$CI_COMMIT_TAG` and `:latest` |

The `workflow:` rules run merge request pipelines, branch pipelines, and tag
pipelines — but suppress the duplicate branch pipeline while an MR is open.

### Pages stage

The `pages` job builds this documentation with MkDocs and publishes it to
GitLab Pages on the default branch. A separate `docs:build` job runs on merge
requests, so a broken MkDocs config fails review rather than the deploy.

```yaml
pages:
  stage: pages
  image: python:3.12-slim
  script:
    - pip install -r docs/requirements.txt
    - mkdocs build --strict --site-dir public
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

`--strict` turns broken internal links and unknown config into build failures.

Build the site locally before pushing:

```bash
pip install -r docs/requirements.txt
mkdocs serve          # live reload on :8000
mkdocs build --strict
```

## Production checklist

- [ ] `tenant.dev_mode` is **off**. The backend trusts the `tenant` claim
      without verifying the signature, so this is load-bearing.
- [ ] The backend is reachable **only** through APISIX — never published
      directly.
- [ ] Database credentials changed from the `shift_user` / `shift_password`
      and `postgres` / `postgres` defaults.
- [ ] `N8N_ENCRYPTION_KEY` changed from `change-me-please`.
- [ ] `deploy/.env` populated and not committed.
- [ ] NATS reachable with JetStream — without it, plans cannot be queued.
- [ ] `postgres_data` volume included in backups
      (`pg_dump -U postgres shift`).
- [ ] TLS terminated at the gateway; the mkcert certificates in
      `deploy/gateway/mkcert/` are for local development only.
