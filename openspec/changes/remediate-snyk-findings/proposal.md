# Proposal

## Why

Snyk cloud (org `maxrgbg`, projects imported from GitHub `uid09552/shift` on
`main`) reports 12 critical and 41 high issues across the shift projects, plus
20 code findings and one npm finding. Almost all of them come from base images
and a dependency we can change cheaply, and the rest are false positives that
nobody has recorded as such. As long as the list stays this long, a real new
finding gets lost in it.

What Snyk reports today (open issues, 2026-10-25):

| Snyk project | Critical | High | Medium | Source |
|---|---|---|---|---|
| `deploy/Dockerfile.backend` | 4 | 9 | 5 | `debian:bookworm-slim` |
| `deploy/Dockerfile.planner` | 4 | 9 | 5 | `python:3.14-slim-bookworm` |
| `deploy/Dockerfile.agent` | 4 | 9 | 5 | `python:3.14-slim-bookworm` |
| `deploy/Dockerfile.ui` | 0 | 14 | 5 | `nginx:alpine` |
| `uid09552/shift` (Snyk Code) | 0 | 1 | 19 | `graph.py`, `seed_data_v2.py` |
| `ui/package.json` | 0 | 0 | 1 | `pdfmake@0.3.11` |

## What Changes

- **Runtime base images move from Debian 12 (bookworm) to Debian 13
  (trixie)**: `debian:trixie-slim` for the backend, `python:3.14-slim-trixie`
  for planner and agent. Their builder stages move with them. The zlib and
  util-linux findings have no fix in bookworm, so staying on bookworm keeps
  them however often the image is upgraded.
- **The UI's nginx base image is pinned** to an exact Alpine-based tag instead
  of the floating `nginx:alpine`. Snyk then reports against a known base, and
  Renovate's `dockerfile` manager proposes the bumps.
- **Unused `@amcharts/amcharts5` and `@amcharts/amcharts5-geodata` are
  removed** from `ui/package.json`. Nothing in `ui/src` imports them, and
  amcharts5 is the only thing that pulls in `pdfmake`, the npm finding with no
  fix.
- **The 20 Snyk Code false positives are recorded, not silenced blindly**:
  - `seed_data_v2.py` (19 × SSRF) is excluded from Snyk Code in a committed
    `.snyk`. It is a developer CLI whose job is to send requests to the URL
    its operator passes.
  - The `api_key="ollama"` placeholder in `agent/shift_agent/agent/graph.py`
    (1 × hardcoded secret) is ignored in Snyk with a reason. Local Ollama
    takes no key, and the OpenAI client only needs a non-empty string.
- **Dependency files Snyk does not cover yet are added to Snyk**:
  `Cargo.lock`, `planner/uv.lock` and `agent/uv.lock` have no Snyk project
  today. The GitHub import did not create any.
- **Verification uses the built images**, not just the Dockerfiles. Snyk's
  Dockerfile projects scan the `FROM` image, while our final stages run
  `apt-get upgrade` / `apk upgrade`. Images are compared before and after with
  `snyk container test`.

Out of scope: product behaviour, the existing Trivy jobs and Renovate rules,
and the untracked `snyk-studio-install.sh`.

## Capabilities

### New Capabilities

None. The change replaces base images, removes an unused dependency and
records scanner decisions. No system behaviour is specified differently, so
the change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- `deploy/Dockerfile.backend`, `deploy/Dockerfile.planner`,
  `deploy/Dockerfile.agent`, `deploy/Dockerfile.ui`: base image tags.
- `ui/package.json`, `ui/package-lock.json`: two dependencies removed.
- New `.snyk` policy file at the repository root.
- Snyk cloud (org `maxrgbg`): one ignore with a reason, and new projects for
  Cargo and uv lockfiles. These are writes to an external system and need the
  owner's go-ahead when they happen.
- Runtime: glibc, OpenSSL, libpq and Python system libraries change versions
  with trixie. The backend binary, `libpq5` and the Python wheels in the
  planner/agent venvs must be rebuilt and smoke-tested on the new base.
