# Proposal

## Why

GitHub Dependabot reports 10 open alerts on `main` (1 high, 8 medium, 1 low),
and every one has a released fix. One of them touches authorization in the
agent's MCP server, which uses FastMCP's auth (`JWTVerifier`, `MultiAuth`).
The others are a TLS handshake flaw in the backend's outgoing HTTPS, unbounded
header parsing in the agent's tracing, and six dev-server issues in Vite.

| Alerts | Package | Lockfile | Locked | Fixed in | Scope |
|---|---|---|---|---|---|
| #116, #117 | fastmcp, fastmcp-slim | `agent/uv.lock` | 3.4.4 | 3.4.10 | runtime |
| #114 | opentelemetry-api | `agent/uv.lock` | 1.44.0 | 1.45.1 | runtime |
| #65 | rustls | `Cargo.lock` | 0.23.40 | 0.23.45 | runtime |
| #70–72, #122–124 | vite | `ui/package-lock.json` | 8.3.0 | 8.3.3 | development |

## What Changes

- **`agent/uv.lock`: fastmcp and fastmcp-slim** go to the latest 3.4.x
  (≥ 3.4.10). This stays on major 3. FastMCP 4 is a separate decision.
- **`agent/uv.lock`: the whole `opentelemetry-*` family** moves together:
  1.44.0 → 1.45.1 and 0.65b0 → 0.66b1. The api, sdk, exporters and
  instrumentations are released as a set. The planner's lock is already on
  1.45.1.
- **`Cargo.lock`: rustls** goes to ≥ 0.23.45, a patch release within the
  range `reqwest` already allows.
- **`ui/package.json`: an npm `overrides` entry pins `vite` to 8.3.3.** The
  latest `@angular/build` (22.2.4) pins vite to exactly 8.3.0, so updating
  Angular cannot fix this. A note next to the override says to remove it
  once `@angular/build` requires a fixed vite.
- **`agent/pyproject.toml`: `fastmcp>=2.3` becomes `fastmcp>=3.4.10,<4`.**
  The open range would let a lock update jump to FastMCP 4 (4.1.3 is out),
  and the floor stops a later lock from going back to a vulnerable 3.x. No
  other manifest range changes: `Cargo.toml` and the OpenTelemetry ranges
  already allow the fixed versions.

Out of scope: FastMCP 4, Angular upgrades, and the open tasks of
`remediate-snyk-findings`.

## Capabilities

### New Capabilities

None. Dependency versions change; no system behaviour is specified
differently. The change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- **Agent:** MCP server and REST API, on a new fastmcp patch release and the
  OpenTelemetry 1.45 / 0.66b line. Covered by `agent/tests`; tracing is
  checked by starting the API.
- **Backend:** rustls under reqwest, used for Keycloak, the holiday API and
  the optimizer. Covered by `cargo build` and `make test`.
- **UI:** dev server and build tooling only. The production bundle is static
  files, but the override changes the vite that `ng build` runs. Covered by
  `npm run build` and an `ng serve` check.
- **GitHub:** the 10 alerts close on their own once the lockfiles are pushed
  to `main`.
