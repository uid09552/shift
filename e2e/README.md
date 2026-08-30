# End-to-end tests

Browser tests for the Angular UI, written with [Robot Framework](https://robotframework.org/)
and the [Browser library](https://marketsquare.github.io/robotframework-browser/)
(Playwright underneath).

They drive a **running system** through the gateway: Angular, the backend, and
Keycloak all have to be up. Nothing is mocked — a passing run means a real user
with a real login sees the page.

## Setup

```bash
cd e2e
make install     # virtualenv + dependencies + `rfbrowser init` (downloads browsers)
```

## Running

```bash
make test                                        # everything, against http://localhost
make smoke                                       # just the smoke-tagged tests
make overview                                    # just the overview suites
make test ARGS="-v BASE_URL:https://staging.example"
make test ARGS="-V config/config.local.yaml"     # a file of overrides
make test ARGS="--include navigation"            # by tag
make test ARGS="-v HEADLESS:False"               # watch it run
```

Reports land in `results/` (`report.html` is the one to open; `log.html` has the
per-keyword detail and a screenshot of every failure).

`make dryrun` parses the suites and resolves every keyword without opening a
browser or needing a target environment — the quickest check after a rename, and
what CI can run when no environment is available.

## Configuration

`config/config.yaml` is a Robot Framework **variable file**: the target URL, the
browser settings, and the accounts to sign in as. It is read automatically by
`resources/common.resource`, so tests never mention a hostname or a password.

Overrides, in increasing priority:

| Where | How | Use it for |
| --- | --- | --- |
| `config/config.yaml` | committed defaults | the local dev stack |
| `config/config.local.yaml` | `robot -V config/config.local.yaml` | your environment, real credentials |
| command line | `robot -v BASE_URL:…` | a one-off run |

`config.local.yaml` is gitignored — copy `config/config.local.yaml.example` to
start one. **Real credentials belong there, never in `config.yaml`.**

The default accounts (`admin` / `viewer`) are the ones the shipped Keycloak realm
imports, see `deploy/iam/realm-shift.json`.

## Layout

```
e2e/
├── config/
│   ├── config.yaml                 # target URL, browser settings, accounts
│   └── config.local.yaml.example   # template for local overrides
├── resources/
│   ├── common.resource             # browser library + lifecycle keywords
│   ├── login.resource              # signing in through Keycloak
│   └── pages/
│       ├── overview_page.resource  # page object: the overview page
│       └── navigation.resource     # page object: the sidebar
└── tests/
    └── overview/
        ├── overview.robot          # the page renders, with real data
        └── overview_roles.robot    # what each role is offered
```

**Tests contain no selectors.** Every locator lives in a page object under
`resources/pages/`, so markup changes are fixed in one place. Page objects expose
keywords in the language of the page ("Metric Should Show A Number"), not of the
DOM.

**Selectors are `data-testid` attributes** put on the UI for this purpose. They
survive restyling and translation, which class names and visible text do not — a
test that looks for "Employees" breaks the moment the UI is used in German.

**Tests assert shape, not seeded values.** A tile has to show *a* count; which
count depends on the data in the environment under test.

## Tags

| Tag | Meaning |
| --- | --- |
| `overview` | touches the overview page |
| `smoke` | the handful that prove the stack is alive; run these first |
| `navigation` | follows a link to another page |
| `rbac` | depends on the signed-in user's role |

## Adding a suite

1. Add the `data-testid` attributes you need to the component.
2. Add a page object under `resources/pages/` with the locators and keywords.
3. Add a `.robot` file under `tests/<area>/`, importing `common.resource`,
   `login.resource` and your page object.
4. `make dryrun` to check every keyword resolves, then `make test`.
