# Design

## Context

- Three lockfiles are involved, one per ecosystem: `agent/uv.lock` (uv),
  `Cargo.lock` (cargo) and `ui/package-lock.json` (npm). The alerts are
  against GitHub's `main`. The same versions are in local `HEAD`.
- `agent/pyproject.toml` declares `fastmcp>=2.3` and the OpenTelemetry
  packages as `>=1.30` / `>=0.51b0`. `Cargo.toml` takes rustls through
  `reqwest = "0.13"` with the `rustls` feature. Nothing pins rustls directly.
- `@angular/build` 22.2.4 is the latest release and depends on `vite` exactly
  `8.3.0`. `ui/package.json` has no `overrides` yet.
- Renovate (`renovate.json5`) groups the Angular packages and raises
  security fixes on its own schedule. This change does not alter its rules.

## Goals / Non-Goals

**Goals:**
- Every alerted package is at or above its first patched version in the
  lockfile on `main`.
- No package moves to a new major version as a side effect.

**Non-Goals:**
- FastMCP 4, Angular or TypeScript upgrades.
- A Dependabot or Renovate configuration change.

## Decisions

**1. Targeted lock updates, not a full refresh.**
Use `uv lock --upgrade-package <name>` and `cargo update -p rustls`, so the
diff contains the alerted packages and only what they drag along. A full
`uv lock --upgrade` or `cargo update` would mix unrelated upgrades into a
security fix and make a regression harder to pin down.

**2. Raise and cap the FastMCP range: `fastmcp>=3.4.10,<4`.**
With `>=2.3`, `--upgrade-package fastmcp` resolves to 4.1.3, a new major
version. The cap keeps it on 3.x, and the floor documents the security
minimum, so a regenerated lock can't fall back below it. `fastmcp-slim`
follows `fastmcp`, which pins it to the same version.
*Alternative:* `uv lock --upgrade-package 'fastmcp<4'` without touching
`pyproject.toml`. It gets the same lock, but nothing records why.

**3. Move the whole OpenTelemetry family together.**
`opentelemetry-api`, `-sdk`, `-proto` and the exporters are released in
lockstep (1.45.1), and the instrumentations as 0.66b1. Upgrading only the
api leaves the sdk asking for `opentelemetry-api==1.44.0`, which fails to
resolve or silently doesn't upgrade. Pass every `opentelemetry-*` package in
`agent/uv.lock` to `--upgrade-package`. The planner already runs this line
(1.45.1), so it is known to work in this repo.

**4. Pin vite through npm `overrides`.**
`"overrides": { "vite": "8.3.3" }` in `ui/package.json`. The `@angular/build`
pin (`8.3.0`) is a patch away, so the override stays inside the version
Angular was built and tested against. JSON allows no comments, so the reason
and the removal condition go in `docs/frontend.md`, next to the dependency
notes, and in the commit message. Once an `@angular/build` release requires
vite ≥ 8.3.3, the override is deleted. Until then, `npm ls vite` shows it.
*Alternative:* dismissing the alerts as dev-only. Rejected: the dev server
runs on this team's Windows/WSL machines, and three of the alerts
(launch-editor) are Windows-specific.

## Risks / Trade-offs

- [The fastmcp 3.4.x patch releases change behaviour the agent relies on,
  for example the auth fix tightening a check the MCP server's tools
  depended on] → run `agent/tests`, then start the MCP server and call one
  tool with and without a token.
- [OpenTelemetry 0.66b instrumentations change span names or attributes] →
  start the agent API with tracing to a console exporter, check that
  requests still produce spans, and run `agent/tests`.
- [A newer rustls rejects a TLS peer it used to accept] → `make test`. The
  backend's outgoing calls go to Keycloak, the holiday API and the
  optimizer.
- [The vite override outlives its reason and holds vite back] → the note in
  `docs/frontend.md` names the condition. When Renovate proposes an
  `@angular/build` update, `npm ci` fails if the override conflicts with a
  newer pin, which forces the cleanup.
- [`npm ci` fails on the override because `@angular/build`'s exact
  dependency conflicts with it] → npm applies overrides to exact dependency
  specs as well; check with `npm ls vite` that only 8.3.3 is installed.

## Migration Plan

Merge, then push to `main`. Dependabot re-scans on push and closes the
alerts. Rollback means reverting the commit: only lockfiles, one manifest
range and the override change.
