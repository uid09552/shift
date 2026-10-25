# Tasks

## 1. Agent (`agent/uv.lock`)

- [x] 1.1 In `agent/pyproject.toml`, change `fastmcp>=2.3` to `fastmcp>=3.4.10,<4`, then run `uv lock --upgrade-package fastmcp --upgrade-package fastmcp-slim` in `agent/`. Verify `grep -A1 '^name = "fastmcp' agent/uv.lock` shows the same 3.4.x version (≥ 3.4.10) for both.
- [x] 1.2 Run `uv lock` with `--upgrade-package` for every `opentelemetry-*` package in `agent/uv.lock`. Verify the api, sdk, proto and exporters are all on 1.45.1 and the instrumentations, semantic-conventions and util-http on 0.66b1, and that `git diff agent/uv.lock` changes nothing outside fastmcp, OpenTelemetry and their own new dependencies.
- [x] 1.3 `uv sync --frozen` and `uv run --with pytest pytest -q tests` in `agent/`. Verify all tests pass.
- [x] 1.4 Start `shift-agent api` with `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317` (nothing listening) and the MCP server. Verify `/api/v1/health` answers 200, the logs show no OpenTelemetry import or setup error, and the MCP endpoint refuses a tool call without a token and accepts one with a valid token.

## 2. Backend (`Cargo.lock`)

- [x] 2.1 `cargo update -p rustls --precise 0.23.46` (a plain `-p rustls` stops at 0.23.43 because it keeps `aws-lc-rs`/`aws-lc-sys`/`rustls-webpki` locked; `--precise` moves them too) and verify `cargo tree -i rustls` shows ≥ 0.23.45 and `git diff Cargo.lock` touches only rustls and what it pulls in.
- [x] 2.2 `make test` and verify it passes.

## 3. UI (`ui/package-lock.json`)

- [x] 3.1 Add `"overrides": { "vite": "8.3.3" }` to `ui/package.json` and run `npm install`. Verify `npm ls vite` lists only 8.3.3, under `@angular/build` and `@vitejs/plugin-basic-ssl`.
- [x] 3.2 Verify `npm run build` passes, and that `ng serve` starts and serves `/planner/`.
- [x] 3.3 In `docs/frontend.md` under *Development*, note the override: why it exists (Dependabot alerts #70–72 and #122–124; `@angular/build` 22.2.4 pins vite 8.3.0) and that it is removed once `@angular/build` requires vite ≥ 8.3.3. Verify `mkdocs build --strict` passes.

## 4. Integration

- [x] 4.1 Run `snyk test --file=agent/uv.lock --package-manager=uv` and `snyk test --file=ui/package-lock.json`. Verify neither reports fastmcp, opentelemetry-api or vite.

## Workflow follow-up

- After pushing to `main`, check that alerts #65, #70–72, #114, #116, #117 and #122–124 show as fixed under GitHub › Security › Dependabot.
- Archive after review.
