# Proposal

## Why

Snyk reports 3 critical and 10 high issues for each of the backend, planner
and agent images (org `maxrgbg`, 2026-10-25). These come from Snyk's
Dockerfile projects, which scan the unpatched base image named in `FROM`
(`debian:trixie-slim`, `python:3.14-slim-trixie`), not the image we ship.
Every runtime stage runs `apt-get upgrade`. In the built images, the perl,
pcre2, gzip and sqlite findings are gone, and only acl, attr and zlib remain
(plus cyrus-sasl in the backend). Debian has no fix for any of these four.

So Snyk's dashboard overstates the risk by roughly 10×, and nothing in Snyk
watches the images that are actually published. A new vulnerability in a
shipped image would show up in Trivy's scheduled re-scan, but not in Snyk.

## What Changes

- **The GitHub Actions build job runs `snyk container monitor`** on each
  built image (backend, planner, ui, agent) for pushes to the default
  branch. Snyk then holds one project per published image, re-tests it daily
  against new advisories, and also covers the Python packages inside the
  planner and agent images.
- **The step never gates the build.** Trivy stays the gate (`SCAN_EXIT_CODE`).
  The Snyk step is skipped without a `SNYK_TOKEN` secret, does not run on
  pull requests, and a Snyk outage does not fail the job.
- **The four no-fix findings get a Snyk ignore** on the new image projects,
  each with a reason and a 90-day expiry, so they come back for review
  rather than disappearing.
- **The Dockerfile projects stay.** They give Snyk's base-image upgrade
  recommendations. The docs explain which project type to read for what.
- **The docs** (`docs/knowledge/operations/deployment-and-ci.md`) describe the
  step, the `SNYK_TOKEN` secret and the two project types.

Out of scope:
- **GitLab CI.** It keeps Trivy only. The GitHub pipeline is the one Snyk is
  connected to.
- **The `graph.py` code finding.** It is `remediate-snyk-findings` task 4.2.
- **Distroless or Alpine runtimes.**

## Capabilities

### New Capabilities

None. This is CI and scanner configuration; no system behaviour is specified
differently. The change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- `.github/workflows/ci.yml`: one step in the `build` job.
- **GitHub repository settings:** a `SNYK_TOKEN` Actions secret (a Snyk
  service-account token for org `maxrgbg`), set by the repository owner.
- **Snyk cloud (org `maxrgbg`):** four new container projects, and four
  ignores on each Debian-based one. These are writes to an external system,
  made with the owner's go-ahead.
- `docs/knowledge/operations/deployment-and-ci.md`.
- **Overlap with `remediate-snyk-findings` task 4.4:** the agent's and
  planner's Python dependencies become visible in Snyk through the images.
  That covers the Python half of 4.4, and Rust stays covered by Trivy.
