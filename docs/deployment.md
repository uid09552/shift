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

Telemetry is wired the same way: set `OTEL_EXPORTER_OTLP_ENDPOINT` (plus
headers and the `CI_*` resource attributes) in `deploy/.env` and every service
starts exporting traces and metrics; leave it empty and none of them do. Each
service's `OTEL_SERVICE_NAME` is pinned in the Compose file. See
[Observability](observability.md).

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

### Version

Every image is built with three build arguments, so each part of the stack
can say what it is:

| Argument | Value |
|---|---|
| `APP_VERSION` | The tag on a tag pipeline, else `<branch>-<short sha>`. A project CI variable `APP_VERSION` overrides both |
| `GIT_COMMIT` | `$CI_COMMIT_SHA` |
| `BUILD_DATE` | UTC time of the build, ISO 8601 |

Where they end up:

- **Backend** — compiled into the binary; `GET /api/v1/info` reports them. The
  `build` config section (`SHIFT_BUILD__VERSION`, …) overrides them at runtime
  — see [Configuration](configuration.md#build).
- **UI** — replaced into the bundle by `ng build --define`; the sidebar shows
  the version, and the backend's too when the two differ. Hover it for the
  commits and build dates.
- **Planner, agent** — environment variables in the image; their
  `/api/v1/health` reports them.
- **Image labels** — `org.opencontainers.image.version`, `.revision`,
  `.created` and `.source`.

`make build` in `deploy/` passes the same arguments for local images, with
`git describe` as the version. Without them, the backend reports its crate
version and the UI reports `dev`.

### Image scanning and SBOMs (Trivy)

Every image is scanned by [Trivy](https://trivy.dev), pinned to `TRIVY_VERSION`
in the pipeline's global `variables:`. Each build job produces, in `security/`:

| File | Contents |
|---|---|
| `gl-container-scanning-report.json` | Vulnerabilities in GitLab's container-scanning schema (rendered by `contrib/gitlab.tpl` from the Trivy release) |
| `gl-sbom-image-<component>.cdx.json` | CycloneDX SBOM of the image — OS packages and any language manifests present in the runtime stage |

The scan runs **inside the build job**, not in a separate one, because merge
request pipelines never push: the image exists only in that job's dind daemon,
and handing it to another job would mean a `docker save` tarball artifact of a
few hundred MB per component. `--image-src docker` pins Trivy to that daemon
(it reads `DOCKER_HOST`) so a lookup failure cannot silently fall through to
scanning whatever the registry already holds.

The steps run **before** the push, so an enabled gate keeps a failing image out
of the registry.

### Source SBOMs

The multi-stage Dockerfiles discard the builder stage, so the backend's crates
and the UI's npm tree never appear in an image SBOM. The `sbom:source` jobs
close that gap by scanning the committed lockfiles — `Cargo.lock`,
`ui/package-lock.json`, `planner/uv.lock`, `agent/uv.lock` — one job per
component, writing `security/gl-sbom-source-<component>.cdx.json`. They declare
`needs: []`, so they start immediately rather than waiting on the build stage.

Both jobs attach their output as `artifacts:reports:cyclonedx` (feeding the
Dependency List) and `artifacts:reports:container_scanning`. Those widgets are
GitLab Ultimate features; on other tiers the files are still downloadable as
ordinary job artifacts, kept for one month.

### Scheduled re-scan of published images

A build-time scan only knows the CVEs that existed the day it ran. An image that
passed last week can be vulnerable today without a line of code changing, and
nothing in a commit-triggered pipeline will ever notice — the pipeline only runs
when someone pushes.

`scan:published` closes that: on a schedule it re-scans the images **already in
the registry** (`:latest`, i.e. what a deployment following `deploy/Makefile`
actually runs) against the current vulnerability database.

It does not rebuild, and needs no Docker daemon — Trivy reads the image straight
out of the registry over the API, so the job runs on the `aquasec/trivy` image
rather than the dind-based `.build`. It emits no SBOM either: the image has not
changed, so it would be byte-for-byte the one `build` already published. Only
the database moved.

Set it up once, in *Build → Pipeline schedules → New schedule*, on the default
branch:

| Field | Value |
|---|---|
| Interval pattern | `0 3 * * *` (nightly at 03:00) |
| Target branch | the default branch |

**GitLab notifies the schedule's owner when a scheduled pipeline fails — that is
the entire delivery mechanism.** Hence `RESCAN_EXIT_CODE` defaults to `1`: a
nightly run that always passes tells nobody anything.

The job is also available as a manual button on the default branch, for when a
CVE lands in the news and 3am is not soon enough. Started that way it is
`allow_failure: true`, so an ad-hoc check does not turn the branch red.

On a scheduled run, `build`, `pages` and `docs:build` are skipped — there is
nothing to rebuild or republish — while `sbom:source` *does* run, under the same
stricter gate, because the lockfiles' dependencies age the same way.

### The scan gate

Findings are reported but do **not** fail the pipeline by default:

| Variable | Default | Effect |
|---|---|---|
| `SCAN_SEVERITY` | `HIGH,CRITICAL` | Severities the gate considers. The report and SBOM always cover all severities. |
| `SCAN_EXIT_CODE` | `0` | `0` reports only; set to `1` to fail the job on a matching finding. |
| `RESCAN_EXIT_CODE` | `1` | The same, for scheduled re-scans. Defaults to failing on purpose — see above. |
| `TRIVY_VERSION` | `0.72.0` | Scanner version; bumping it invalidates the cached binary. |

To enforce, set `SCAN_EXIT_CODE` to `1` in the file or as a project CI variable
(*Settings → CI/CD → Variables*). The image gate adds `--ignore-unfixed`, so it
only fires on findings a base-image bump can actually resolve.

These are deliberately **not** named `TRIVY_SEVERITY` / `TRIVY_EXIT_CODE`:
Trivy reads those from the environment on its own, which would silently apply
the gate's severity filter to the full report and the SBOM as well.

Two caches keep the jobs off external rate limits: the Trivy binary (keyed by
`TRIVY_VERSION`) and the ~50 MB vulnerability database it otherwise pulls from
`ghcr.io` on every run.

Reproduce a job locally:

```bash
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed shift/backend:latest
trivy fs --format cyclonedx --output sbom.cdx.json --skip-dirs ui,planner,agent,target .

# What the scheduled re-scan does, against the registry rather than a local image
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
  registry.gitlab.com/<group>/<project>/backend:latest
```

### Dependency updates (Renovate)

The `renovate` job runs [Renovate](https://docs.renovatebot.com) against this
project and opens a merge request for each new version of something the
services depend on. `renovate.json5` at the repository root says what to update
and how to bundle it:

| What | Where |
|---|---|
| Rust crates | `Cargo.toml`, `Cargo.lock` |
| npm packages | `ui/package.json`, `ui/package-lock.json` |
| Python packages | `planner/` and `agent/` `pyproject.toml` + `uv.lock`; `docs/` and `e2e/` `requirements.txt` |
| Container images | `deploy/Dockerfile.*`, the Compose files in `deploy/` and `release/`, the images in `.gitlab-ci.yml` (Renovate's own included) |
| Trivy | `TRIVY_VERSION` in `.gitlab-ci.yml`, following the `aquasec/trivy` image |

Minor and patch updates are bundled per service: one merge request each for
the backend, the UI, the planner, the agent, and the docs/e2e tooling. Majors
get their own, since they are the ones that need reading. Two exceptions: a
0.x package's minor bump breaks like a major and is kept separate, and a
TypeScript major travels with the Angular major. Security fixes (from the OSV
database) get a merge request straight away, labelled `security`. On Mondays,
a *lock file maintenance* merge request refreshes the four lockfiles within the
ranges already allowed.

Every Renovate merge request runs the normal MR pipeline, so all four images are
built and scanned before anyone merges. Nothing is merged automatically. Branch
pipelines are skipped for `renovate/*` branches (the MR pipeline follows
immediately), and Renovate rebases only on a conflict, so each update is built
as few times as possible.

A PostgreSQL or Keycloak **major** is a data migration, not a version bump. It
waits on the *Dependency Dashboard*, an issue Renovate keeps up to date with
every pending update, until someone ticks it there. Ticking any other entry
makes the next run open that merge request.

The `ieapp/` Flutter app is left out: this pipeline does not build it, so
nothing would test an update. Delete that rule in `renovate.json5` to include
it.

Set it up once:

1. *Settings → Access tokens*: add a project access token with role
   **Developer** and scopes **`api`** and **`write_repository`**. Renovate pushes
   its branches and opens merge requests as that token's bot user. Project
   tokens expire (a year at most), so renew it in time or the job fails with
   `401 Unauthorized`.
2. *Settings → CI/CD → Variables*: `RENOVATE_TOKEN` = that token, **masked** and
   **protected**.
3. Recommended: `GITHUB_COM_TOKEN` = a GitHub token with no scopes. Renovate
   uses it for the release notes in its merge requests. Without it, one run
   exceeds github.com's anonymous rate limit.
4. *Build → Pipeline schedules → New schedule*:

   | Field | Value |
   |---|---|
   | Interval pattern | `0 5 * * 1-5` (weekdays at 05:00) |
   | Cron timezone | Europe/Berlin |
   | Target branch | the default branch |
   | Variable | `RENOVATE` = `true` |

5. Keep **Issues** enabled for the Dependency Dashboard.

The variable is what tells this schedule apart from the nightly re-scan: with
`RENOVATE=true` only the `renovate` job runs, and without it, it never does. To
run it right away, use *Build → Pipelines → Run pipeline* on the default branch
with the same variable. The job keeps its debug log (`renovate-log.ndjson`) as
an artifact for a week.

Check a change to `renovate.json5` before committing it:

```bash
docker run --rm -v "$PWD/renovate.json5:/usr/src/app/renovate.json5:ro" \
  ghcr.io/renovatebot/renovate:44.93.0 renovate-config-validator --strict
```

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
