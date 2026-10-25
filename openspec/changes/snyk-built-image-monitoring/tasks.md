# Tasks

## 1. Workflow

- [ ] 1.1 Add `SNYK_VERSION: "1.1308.3"` to the top-level `env:` of `.github/workflows/ci.yml`, next to `TRIVY_VERSION`, and a matching regex entry (datasource `npm`, package `snyk`) to the custom managers in `renovate.json5`. Verify `npx --package renovate -- renovate-config-validator renovate.json5` passes.
- [ ] 1.2 In the `build` job, between "Upload scan"/artifact upload and "Push", add the step "Snyk monitor": `SNYK_TOKEN` from secrets in `env`; `if:` push to the default branch and token present; `continue-on-error: true`. It runs `npm install -g "snyk@$SNYK_VERSION"`, then `snyk container monitor "$IMAGE" --file="deploy/Dockerfile.$COMPONENT" --org=maxrgbg --project-name="uid09552/shift:image-$COMPONENT" --target-reference=main`. Verify with `actionlint .github/workflows/ci.yml` (or `npx action-validator`) that the workflow parses, and that the `if:` reads `env.SNYK_TOKEN`, not `secrets.*`.
- [ ] 1.3 Dry-run the command locally against the images built in `remediate-snyk-findings` (`shift-<component>:after`), using `snyk container test` with the same `--file`/`--org`. Verify the backend, planner and agent each report only acl, attr, zlib (and cyrus-sasl for the backend) at high or above, and the UI none.

## 2. Repository and Snyk setup (owner)

- [ ] 2.1 The repository owner creates a Snyk service-account token for org `maxrgbg` and stores it as the Actions secret `SNYK_TOKEN` on `uid09552/shift`. Verify with `gh secret list -R uid09552/shift` that `SNYK_TOKEN` is listed.
- [ ] 2.2 After the first push to `main` with the step, verify in the job log that "Snyk monitor" ran for all four matrix jobs, and that the Snyk project list for `maxrgbg` shows `uid09552/shift:image-backend`, `-planner`, `-ui` and `-agent`.
- [ ] 2.3 With the owner's go-ahead, ignore the no-fix findings (acl, attr, zlib; cyrus-sasl on the backend) on each image project, with the reason from design Decision 3 and a 90-day expiry. Verify the image projects show 0 critical and 0 open high findings.

## 3. Documentation

- [ ] 3.1 In `docs/knowledge/operations/deployment-and-ci.md`, next to the Trivy section, describe the Snyk step: what it monitors, the `SNYK_TOKEN` secret, that Trivy gates and Snyk tracks, and which Snyk project type to read for what (`image-*` vs Dockerfile). Verify `mkdocs build --strict --site-dir site` passes.

## Workflow follow-up

- In `remediate-snyk-findings`, mark the Python half of task 4.4 as covered by the image projects once 2.2 holds.
- After 90 days, review the ignores from 2.3: renew them or drop them if Debian has shipped fixes.
- Archive after review.
