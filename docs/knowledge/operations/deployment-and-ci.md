---
type: Runbook
title: Deployment and CI
description: The four images, the Compose stack, registry tagging, and the GitLab pipeline including Trivy scanning, SBOMs and Pages.
resource: deploy/docker-compose.yml
tags: [operations, deployment, docker, ci, gitlab, security]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/deployment.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: .gitlab-ci.yml
    author: human:maxrg
    last_modified: 2026-07-31
---

# Images

| Image | Dockerfile | Contents |
|---|---|---|
| `backend` | `deploy/Dockerfile.backend` | Rust binary — `rust:1.88-bookworm` builder, `debian:bookworm-slim` runtime |
| `planner` | `deploy/Dockerfile.planner` | Python optimizer with OR-Tools |
| `ui` | `deploy/Dockerfile.ui` | Angular build served by nginx (`deploy/nginx.conf`) |
| `agent` | `deploy/Dockerfile.agent` | Chat agent **and** MCP server |

`mcp` is not a separate image: Compose runs the `agent` image with a different
command, so there is one image to build, tag and push instead of two identical
ones.

All Dockerfiles `COPY` from the repository root, so the **build context is the
root**, not `deploy/`.

# Compose stack

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

Two **external** networks must exist first:

```bash
docker network create backend
docker network create dev_backend
cp deploy/.env.example deploy/.env
cd deploy && make up && make ps && make logs
make down        # or: make clean, which also removes volumes
```

Individual services: `make backend`, `make planner`, `make agent`, `make mcp`,
`make ui`, `make gateway`.

Two values are pinned in the Compose file rather than `.env` because they depend
on it: `MCP_SERVER_URL: http://mcp:8900/mcp` on the agent (a Compose service
name), and `MCP_OAUTH_CLIENT_ID`/`_SECRET` blanked on `mcp` — see
[Gateway and identity](/architecture/gateway-and-identity.md).

The identity provider is separate: `deploy/iam/docker-compose.yml` runs Keycloak
26.2 with its own PostgreSQL, so the IdP can be cycled independently.
`deploy/gateway/` holds the APISIX standalone config plus mkcert certificates for
local HTTPS on `lvh.me`.

# Registry

`deploy/Makefile` tags and pushes to `registry.gitlab.com/uid09552/shift`:

```bash
make version     # the tag that would be used
make tag         # build + tag <registry>/<component>:<version> and :latest
make push        # push those tags
make push-all    # tag + push
make push VERSION=1.2.3
make push-all REGISTRY=registry.example.com/other-project
```

`VERSION` defaults to `git describe --tags --always --dirty`, falling back to
`latest`.

# GitLab CI

**Runner requirements.** Jobs are untagged, so any instance runner picks them up.
The build job uses Docker-in-Docker and requires `privileged = true` under
`[runners.docker]` — without it, dind cannot start and `docker info` fails with
*"Cannot connect to the Docker daemon"*.

The CLI and dind must agree on transport. `.build` pins both to plain TCP
(`DOCKER_TLS_CERTDIR: ""` with `DOCKER_HOST: tcp://docker:2375`), because setting
`DOCKER_TLS_CERTDIR` makes dind serve TLS on **2376 only**. For TLS instead, set
all four of `DOCKER_TLS_CERTDIR: "/certs"`, `DOCKER_HOST: tcp://docker:2376`,
`DOCKER_TLS_VERIFY: 1`, `DOCKER_CERT_PATH: /certs/client`.

**Container Registry must be enabled for the project.** `CI_REGISTRY_IMAGE` is
only defined when the *project's* registry is on; `CI_REGISTRY` is defined
whenever the *instance* has one — so `docker login` can succeed while
`CI_REGISTRY_IMAGE` is empty, producing an invalid tag like `/planner:abc1234`.
`.build` derives the base from `$CI_REGISTRY/$CI_PROJECT_PATH` (lowercased) when
`CI_REGISTRY_IMAGE` is missing, and fails with an explanation when neither is set.
Pushes still require the project feature.

**Build stage.** `.build` is a `parallel: matrix` over `backend`, `planner`, `ui`,
`agent`. `before_script` polls for the daemon for ~60s; the job retries on
`runner_system_failure` / `stuck_or_timeout_failure`. Each job warms the layer
cache from `:latest` and builds with `BUILDKIT_INLINE_CACHE=1` and `--cache-from`.

| Pipeline | Result |
|---|---|
| Merge request | Built, **not** pushed |
| Any branch | Push `:$CI_COMMIT_SHORT_SHA` |
| Default branch | Also push `:latest` |
| Tag | Also push `:$CI_COMMIT_TAG` and `:latest` |

## Trivy scanning and SBOMs

Every image is scanned by Trivy, pinned to `TRIVY_VERSION`. Each build job writes
into `security/`:

| File | Contents |
|---|---|
| `gl-container-scanning-report.json` | Vulnerabilities in GitLab's schema |
| `gl-sbom-image-<component>.cdx.json` | CycloneDX SBOM of the image |

The scan runs **inside the build job**, not a separate one, because merge request
pipelines never push: the image exists only in that job's dind daemon, and handing
it over would mean a `docker save` tarball of a few hundred MB per component.
`--image-src docker` pins Trivy to that daemon so a lookup failure cannot silently
fall through to scanning whatever the registry already holds. Steps run **before**
the push, so an enabled gate keeps a failing image out of the registry.

**Source SBOMs.** Multi-stage Dockerfiles discard the builder stage, so the
backend's crates and the UI's npm tree never appear in an image SBOM. The
`sbom:source` jobs scan the committed lockfiles — `Cargo.lock`,
`ui/package-lock.json`, `planner/uv.lock`, `agent/uv.lock` — writing
`security/gl-sbom-source-<component>.cdx.json`. They declare `needs: []` and start
immediately.

**The gate.** Findings are reported but do not fail the pipeline by default:

| Variable | Default | Effect |
|---|---|---|
| `SCAN_SEVERITY` | `HIGH,CRITICAL` | Severities the gate considers; report and SBOM always cover all |
| `SCAN_EXIT_CODE` | `0` | `0` reports only; `1` fails the job on a matching finding |
| `TRIVY_VERSION` | `0.72.0` | Bumping it invalidates the cached binary |

These are deliberately **not** named `TRIVY_SEVERITY` / `TRIVY_EXIT_CODE`: Trivy
reads those from the environment itself, which would silently apply the gate's
filter to the full report and the SBOM too.

Reproduce locally:

```bash
trivy image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed shift/backend:latest
trivy fs --format cyclonedx --output sbom.cdx.json --skip-dirs ui,planner,agent,target .
```

## Pages

The `pages` job builds the MkDocs site and publishes to GitLab Pages on the
default branch; `docs:build` runs the same on merge requests so a broken config
fails review rather than the deploy. `--strict` turns broken internal links and
unknown config into build failures.

```bash
pip install -r docs/requirements.txt
mkdocs serve            # live reload on :8000
mkdocs build --strict
```

This OKF bundle lives under `docs/knowledge/` and is excluded from the MkDocs
build via `exclude_docs` — it is consumed as files, not rendered as pages.

# Related

* [Production checklist](/operations/production-checklist.md)
* [Local development](/operations/local-development.md)
