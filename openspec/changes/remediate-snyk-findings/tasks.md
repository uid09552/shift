# Tasks

## 1. Baseline

- [x] 1.1 Build the four images from the repository root (`docker build -f deploy/Dockerfile.<name> -t shift-<name>:before .`). Run `snyk container test shift-<name>:before --file=deploy/Dockerfile.<name> --severity-threshold=high` on each and save the outputs in the scratchpad. Verify there are four reports to compare against in 5.1.
- [x] 1.2 Check the target tags exist: `docker pull` `rust:1.99-trixie`, `python:3.14-slim-trixie`, `debian:trixie-slim` and the current stable `nginx:<version>-alpine`. Verify all four pull. If one doesn't, record the nearest patch tag used instead in the change summary.

## 2. Debian trixie for backend, planner and agent

- [ ] 2.1 In `deploy/Dockerfile.backend`, switch the builder to `rust:1.99-trixie` and the runtime to `debian:trixie-slim`, keeping the `apt-get upgrade` step and `ca-certificates libpq5`. Verify the image builds and `docker run` against a local Postgres (`make db-up`) answers `GET /api/v1/info`.
- [ ] 2.2 In `deploy/Dockerfile.planner`, switch both stages to `python:3.14-slim-trixie`. Verify the image builds and `docker run --rm shift-planner python -m shift_planner schedule` (or the CLI equivalent) solves `planner/input.json` with status optimal or feasible.
- [ ] 2.3 In `deploy/Dockerfile.agent`, switch both stages to `python:3.14-slim-trixie`. Verify the image builds and its `shift-agent api` container answers its health endpoint on port 8899.
- [ ] 2.4 Update the image tables in `docs/deployment.md` and `docs/knowledge/operations/deployment-and-ci.md`. They still say `rust:1.88-bookworm`; make them say `rust:1.99-trixie` builder and `debian:trixie-slim` runtime. Verify `grep -rn bookworm docs/` returns nothing.

## 3. UI image and dependencies

- [ ] 3.1 In `deploy/Dockerfile.ui`, replace `FROM nginx:alpine` with the exact tag from 1.2 and keep `apk upgrade --no-cache`. Verify the image builds and serves `index.html` on port 80.
- [ ] 3.2 Remove `@amcharts/amcharts5` and `@amcharts/amcharts5-geodata` with `npm uninstall` in `ui/`. Verify `grep -rn amcharts ui/src ui/package.json` is empty, `grep -c '"node_modules/pdfmake"' ui/package-lock.json` is 0, and `npm run build` and `npm test -- --watch=false` pass.
- [x] 3.3 Remove the "AMCharts 5" line from the Frontend lists in `CLAUDE.md` (Charts, Frontend Dependencies). Verify `grep -n amcharts CLAUDE.md` is empty.

## 4. Record Snyk decisions

- [x] 4.1 Add a `.snyk` at the repository root with `version: v1.25.0` and `exclude: code: [seed_data_v2.py]`, with a comment giving the reason (developer CLI; the target URL is the operator's choice). Verify `snyk code test` on the repository root no longer reports `seed_data_v2.py`.
- [ ] 4.2 With the Snyk org owner's go-ahead, ignore the "Hardcoded Non-Cryptographic Secret" finding at `agent/shift_agent/agent/graph.py:227` on the `uid09552/shift` Snyk Code project. Reason: "placeholder; local Ollama has no auth, ChatOpenAI needs a non-empty key". No expiry. Verify `snyk code test` shows 0 open issues, with the one ignored issue still listed under `--include-ignores`.
- [ ] 4.3 Run `snyk test --all-projects --exclude=node_modules,target,.venv` and confirm that `Cargo.lock`, `planner/uv.lock` and `agent/uv.lock` are each resolved. Note any this CLI version can't resolve.
- [ ] 4.4 With the Snyk org owner's go-ahead, run `snyk monitor --all-projects --exclude=node_modules,target,.venv --org=maxrgbg`. Verify the Snyk project list for `maxrgbg` contains a project for each lockfile resolved in 4.3, and fix or ignore any critical/high finding they show.

## 5. Integration check

- [ ] 5.1 Rebuild the four images as `shift-<name>:after` and rerun the `snyk container test` from 1.1. Verify there are no critical findings, and no high finding with an available fix. Put the before/after counts in the merge request description.
- [ ] 5.2 Bring up the full stack with `deploy/docker-compose.yml` on the new images. Verify the UI loads, a login works, and a plan run (`POST /planner/plan`) completes. Then run `make e2e ARGS="--include smoke"` and verify it passes.

## Workflow follow-up

- After the merge reaches `main`, check that the four Dockerfile projects and `ui/package.json` in Snyk cloud have re-tested and show the expected counts.
- Archive the change once reviewed.
