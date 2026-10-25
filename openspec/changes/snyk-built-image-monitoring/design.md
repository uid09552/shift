# Design

## Context

- `.github/workflows/ci.yml`, job `build`, matrix
  `component: [backend, planner, ui, agent]`: it builds each image into the
  local daemon (`load: true`), scans it with Trivy (SARIF, SBOM, gate), then
  pushes to `ghcr.io/<repo>/<component>`. The gate is
  `SCAN_EXIT_CODE` (default `0`). The scheduled `scan:published`-style job
  re-scans the registry nightly.
- The Snyk org `maxrgbg` gets the GitHub import of `uid09552/shift`:
  Dockerfile, npm, pip and Snyk Code projects. There are no container
  projects.
- A local scan of the built trixie images (`snyk container test`,
  2026-10-25) found 0 critical, and 3–4 high, all without a fix:
  `acl/libacl1`, `attr/libattr1`, `zlib/zlib1g`, and
  `cyrus-sasl2/libsasl2-modules-db` (backend, through `libpq5`). The UI image
  was clean.

## Goals / Non-Goals

**Goals:**
- Snyk shows the images as published, re-tested daily, with no change to
  how the build passes or fails.
- Known no-fix findings are acknowledged with an expiry, not hidden for good.

**Non-Goals:**
- Making Snyk a build gate. Trivy already is one, and two gates on the same
  question disagree at the margins.
- Scanning pull-request images in Snyk. A fork has no secret, and a
  short-lived branch snapshot would litter the org with projects.

## Decisions

**1. Install the CLI from npm at a pinned version, not through a third-party
action.**
`npm install -g snyk@1.1308.3`, the version verified in this repo, then
`snyk container monitor`. The version lives in the workflow's `env:` as
`SNYK_VERSION: "1.1308.3"`, next to `TRIVY_VERSION`. A second regex entry in
`renovate.json5`'s custom managers (`SNYK_VERSION: "(?<currentValue>[^"]+)"`,
datasource `npm`, package `snyk`) keeps it current, the way `TRIVY_VERSION`
is kept today.
*Alternative:* `snyk/actions/docker`. It is another action to pin and trust,
and it pulls a CLI image of its own.

**2. Run after the Trivy steps and before Push, only for default-branch
pushes, never failing the job.**
```yaml
- name: Snyk monitor
  if: github.event_name == 'push' && github.ref_name == github.event.repository.default_branch && env.SNYK_TOKEN != ''
  continue-on-error: true
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```
The secret is mapped into `env` so that the `if:` can test it (secrets are
not readable in `if:`). The command:
`snyk container monitor "$IMAGE" --file=deploy/Dockerfile.$COMPONENT
--org=maxrgbg --project-name="uid09552/shift:image-$COMPONENT"
--target-reference=main`. Passing `--file` gives Snyk the base-image upgrade
advice, and the fixed project name keeps one project per image rather than
one per commit.

**3. Ignores: per image project, per issue, 90 days, with a reason.**
Made in the Snyk UI (or the API) after the first monitor run creates the
projects: "No fixed package in Debian 13; apt-get upgrade in the runtime
stage picks it up once published." A path-level `.snyk` ignore does not
apply to container OS packages from the GitHub import, and a permanent
ignore would hide the fix when Debian ships one.

**4. Keep the Dockerfile projects.**
They answer a different question (is there a better base image?), and
removing them only undoes the GitHub import's next scan. The docs say: read
`image-*` projects for what ships, and Dockerfile projects for base-image
advice.

## Risks / Trade-offs

- [The secret is missing or expired] → the step is skipped or fails quietly
  (`continue-on-error`). The docs name the secret, and the job log shows the
  skip.
- [Monitoring all four images adds about a minute per matrix job] → the
  image is already in the local daemon, so there is no second pull. This is
  acceptable on default-branch pushes only.
- [The Snyk free plan's container test limits] → four monitors per push to
  `main`. Check the org's usage after a week.
- [Two scanners disagree] → Trivy gates, Snyk tracks. The docs say so.

## Migration Plan

Add the secret, merge, and push to `main`. The first run creates the four
projects, then the ignores are added. Rollback means deleting the step; the
Snyk projects can be deactivated in the UI.
