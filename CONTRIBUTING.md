# Contributing to Shift Planner

Thank you for helping. This page covers how to report a problem, how to set up
the code, and what a merge request needs before it can be merged.

## Ways to help

- **Report a bug.** Open an issue with what you did, what you expected, and
  what happened instead. For a planning result that looks wrong, the planning
  period and the result's `message` help most. Leave out personal data about
  real staff.
- **Suggest a feature.** Describe the ward situation it solves before the
  solution. [docs/ui-proposals.md](docs/ui-proposals.md) lists what is already
  planned and what each item would cost.
- **Improve the documentation.** Everything under [`docs/`](docs/) is Markdown.
  Corrections from people who plan real rosters are especially valuable.
- **Translate.** UI text lives in `ui/src/app/shared/i18n/`. English (`en.ts`)
  is the reference; the build fails until every other language has every key.
- **Write code.** Pick an open issue, or open one first for anything larger
  than a fix, so we can agree on the approach before you invest time in it.

## Setting up

[docs/getting-started.md](docs/getting-started.md) walks through every
component. In short:

| Component | Needs | Run |
|---|---|---|
| Backend (`src/`) | Rust stable, Docker | `make db-up`, then `make serve PORT=8082 DEV=1 TENANT_ID=0` |
| Optimizer (`planner/`) | Python 3.11+, [uv](https://docs.astral.sh/uv/) | `cd planner && make install && make nats` |
| Web app (`ui/`) | Node.js 20+ | `cd ui && npm install && npm start` |
| Assistant (`agent/`) | Python 3.11+, uv, an LLM API key | see [agent/README.md](agent/README.md) |
| Documentation | Python | `pip install -r docs/requirements.txt && mkdocs serve` |

`--dev-mode` (`DEV=1`) skips login and pins every request to one tenant. It is
for development only.

## Before you open a merge request

Run the checks for whatever you touched:

| You changed | Check with |
|---|---|
| Rust | `cargo fmt`, `cargo clippy --all-targets`, `make test` |
| Optimizer | `cd planner && make test` |
| Web app | `cd ui && npm run build && npm test -- --watch=false` |
| Documentation | `mkdocs build --strict` |
| `renovate.json5` | the validator command in [.gitlab-ci.yml](.gitlab-ci.yml), above the `renovate` job |

Integration tests in `tests/` need PostgreSQL (`make db-up`). Without it they
print a notice and pass, so run them against a database before you rely on a
green result. UI unit tests need Chrome or Chromium; point `CHROME_BIN` at it
if Karma cannot find one.

Also follow these conventions:

- **API changes go into [`api/openapi.yaml`](api/openapi.yaml).** The spec is
  not just documentation: the assistant's tools are generated from it, so an
  endpoint missing from the spec is one the assistant cannot use.
- **Schema changes go into a new migration.** Add a new directory under
  `migrations/` and update `src/schema.rs`. Never edit a migration that has
  been released; existing databases have already run it.
- **New planner settings go through every layer:** the migration, the backend
  model and API, the optimizer's `ConstraintConfig` with the same default, and
  the settings page. A setting that exists in only some layers does nothing.
- **Tenant isolation is not optional.** Every query filters by the request's
  tenant. A test that creates data uses its own throwaway tenant and deletes
  it afterwards.
- **UI text is always translated.** Add keys to `en.ts` and `de.ts`; never
  hard-code user-facing strings in templates.
- **Match the code around you.** Explain *why* in comments, not *what*. Prefer
  small, focused changes over broad refactors.

## Merge requests

1. Fork the project and branch from `main`.
2. Keep one concern per merge request. A fix and an unrelated clean-up are two
   merge requests.
3. Describe what changes for the people using it and how you tested it. Link
   the issue it resolves.
4. The pipeline builds and scans all four container images. It must pass
   before review.
5. A maintainer reviews. Expect questions: the aim is a change that is easy to
   maintain, not just one that works.

Dependency updates arrive as merge requests from Renovate. They are reviewed
like any other; a major version usually needs a closer look at its changelog.

## Security

Please **do not report security problems in public issues.** Open a
[confidential issue](https://docs.gitlab.com/user/project/issues/confidential_issues/)
on the project instead, describing the problem and how to reproduce it. We will
confirm receipt, work on a fix, and credit you when it is released, if you
wish.

This covers anything that lets one tenant see or change another tenant's data,
bypasses a role check, or exposes credentials or personal data.

## Conduct

Be respectful and assume good intent. This project follows the
[Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/),
version 2.1. Report unacceptable behaviour to the maintainers through a
confidential issue.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license as the project (section 5 of the
license). There is no separate contributor agreement to sign.
