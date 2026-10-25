# Design

## Context

- Four images are built from `deploy/Dockerfile.*`, each with a builder stage
  and a runtime stage. Backend: `rust:1.99-bookworm` → `debian:bookworm-slim`
  with `ca-certificates` and `libpq5`. Planner and agent:
  `python:3.14-slim-bookworm` in both stages, with a uv-built `.venv` copied
  across. UI: `node:24-slim` → `nginx:alpine`.
- Every runtime stage already runs `apt-get upgrade` / `apk upgrade`. So
  Snyk's Dockerfile projects, which scan the `FROM` image, overstate what we
  ship. They still show the issues no package upgrade can clear.
- The GitLab pipeline scans each built image with Trivy (`TRIVY_VERSION`
  0.76.0, `SCAN_SEVERITY: HIGH,CRITICAL`) and re-scans the registry on a
  schedule. Renovate's `dockerfile` and `docker-compose` managers keep base
  images current. Both stay as they are.
- Snyk cloud is fed by the GitHub import of `uid09552/shift`. It has projects
  for the four Dockerfiles, `ui/package.json`, two `requirements.txt` files
  and Snyk Code. It has none for `Cargo.lock` or the two `uv.lock` files.
- The local Snyk MCP server cannot scan this folder until it is trusted, and
  its trust flow fails under WSL because it cannot open a browser. The
  authenticated `snyk` CLI (1.1308.3) works.

## Goals / Non-Goals

**Goals:**
- No critical findings, and no high finding that has a fix, on the four
  Dockerfile projects in Snyk.
- Every remaining Snyk Code and npm finding is either fixed or ignored with a
  written reason.
- Rust and Python dependencies are visible in Snyk.

**Non-Goals:**
- Replacing Trivy with Snyk in CI, or adding a Snyk CI gate.
- Distroless or Alpine runtimes for backend/planner/agent. That would be a
  bigger change, with libpq and musl questions of its own.
- Hardening `seed_data_v2.py` beyond what is needed to record the decision.

## Decisions

**1. Debian 13 (trixie) for all three Debian-based images, both stages.**
The critical `zlib1g` finding and the four high `util-linux` findings have no
fixed package in bookworm, so no `apt-get upgrade` will clear them. Trixie is
the current Debian stable and ships newer zlib and util-linux. The builder
moves too (`rust:1.99-trixie`, `python:3.14-slim-trixie`) so that each binary
and venv runs against the same glibc and libpq it was built against.
*Alternatives:* switching only the runtime stage would work for Rust (older
glibc → newer runs), but it splits the stages for no gain. Ignoring the no-fix
findings keeps a critical on the list indefinitely. Distroless is out of scope
(see Non-Goals).

**2. Pin `nginx` to an exact Alpine tag, e.g. `nginx:<version>-alpine`.**
Use the current stable release at implementation time. The floating
`nginx:alpine` makes Snyk's Dockerfile project and our builds disagree on
which base they mean, and it hides the upgrade from Renovate. `apk upgrade`
stays, so fixes published between base releases are still picked up.
*Alternative:* leave the tag floating. It is reproducible only by accident.

**3. Remove `@amcharts/amcharts5` and `@amcharts/amcharts5-geodata`.**
`grep` over `ui/src` and `ui/angular.json` finds no import, and in
`package-lock.json` amcharts5 is the only package that depends on `pdfmake`.
Removing them clears the finding and shrinks the install.
*Alternative:* ignore the pdfmake finding in Snyk. It has no fix, and the
code that would reach it is never loaded, but an ignore would outlive the
reason for it.

**4. `.snyk` excludes `seed_data_v2.py` from Snyk Code; the `graph.py`
placeholder is ignored in Snyk cloud.**
Snyk Code honours path exclusions in a committed `.snyk` (`exclude: code:`),
and the GitHub import reads that file. Per-issue Snyk Code ignores are
managed in Snyk, not in `.snyk`. For the single `api_key="ollama"` finding,
an ignore on the `uid09552/shift` Snyk Code project is the narrowest record,
with reason "placeholder; local Ollama has no auth, ChatOpenAI needs a
non-empty key". *Alternatives:* move the literal into `config.py` as
`ollama_api_key`. The scanner would probably flag the default there instead,
and readers would mistake it for a real setting. Excluding all of
`agent/shift_agent/agent/` would hide future real findings.

**5. Get the lockfiles into Snyk with `snyk monitor`.**
`snyk monitor --all-projects --exclude=node_modules,target,.venv` from the
repository root, under org `maxrgbg`. Before monitoring, `snyk test` confirms
which of `Cargo.lock` / `uv.lock` this CLI version resolves. A lockfile it
cannot read stays covered by Trivy's `sbom:source` job and is named in the
summary. *Alternative:* re-import from GitHub. It already skipped these
files.

**6. Measure with `snyk container test` on built images, before and after.**
Building each image locally and testing it gives the numbers we actually
ship. The Dockerfile projects in Snyk cloud update on their own after the
change reaches `main`.

## Risks / Trade-offs

- [Trixie changes libpq, OpenSSL and glibc versions] → rebuild all three
  images and smoke-test them: backend connects to Postgres and serves
  `/api/v1/info`; planner solves `planner/input.json`; agent answers its
  health endpoint.
- [A trixie image for the pinned Rust or Python version may not exist] →
  check the tags before editing. If one is missing, take the nearest patch
  version and record it.
- [Trixie has findings of its own] → compare before/after with
  `snyk container test`. The goal is fewer criticals and highs, not zero.
- [Pinned nginx goes stale] → Renovate's `dockerfile` manager raises the
  bump. `apk upgrade` covers the time in between.
- [Removing amcharts breaks the build if something loads it indirectly] →
  `npm run build` and the UI unit tests must pass after removal.
- [`snyk monitor` and the cloud ignore write to an external system] → done
  by, or with the explicit go-ahead of, the Snyk org owner.

## Migration Plan

Deploy as a normal image release. Rollback means redeploying the previous
image tags. No data or schema is involved.
