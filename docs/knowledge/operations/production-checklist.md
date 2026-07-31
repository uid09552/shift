---
type: Checklist
title: Production Checklist
description: What must be true before this system faces real users — the load-bearing items and why each one matters.
tags: [operations, production, security, checklist]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/deployment.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: docs/auth.md
    author: human:maxrg
    last_modified: 2026-07-31
---

# Security

- [ ] **`tenant.dev_mode` is off.** With it on, every unauthenticated request
      operates on one configured tenant — no authentication, no separation.
- [ ] **The backend is reachable only through APISIX.** It decodes the JWT payload
      without verifying the signature, trusting the gateway to have done so.
      Published directly, the `tenant` claim is forgeable and any caller can read
      any hospital's roster. This is the single most load-bearing item on the
      list — see [Tenant isolation](/architecture/tenant-isolation.md).
- [ ] **TLS terminated at the gateway.** The mkcert certificates in
      `deploy/gateway/mkcert/` are for local development on `lvh.me` only.
- [ ] **Database credentials changed** from the `shift_user`/`shift_password` and
      `postgres`/`postgres` defaults.
- [ ] **`N8N_ENCRYPTION_KEY` changed** from `change-me-please`.
- [ ] **`deploy/.env` populated and not committed.** Only `.example` templates are
      tracked; the real file holds LLM keys and OIDC client secrets.

# Availability

- [ ] **NATS reachable with JetStream.** Without a broker, `POST /planner/plan`
      fails with 500 and no plan can be queued — the rest of the API keeps serving,
      which makes this easy to miss. Without JetStream specifically, delivery falls
      back to plain publish and loses durability. See
      [Data stores](/architecture/data-stores.md).
- [ ] **Both external Docker networks exist** — `backend` and `dev_backend`.

# Data

- [ ] **`postgres_data` volume included in backups.**

      ```bash
      docker exec shift_postgres pg_dump -U postgres shift > shift-$(date +%F).sql
      ```

- [ ] **Direct database access treated as privileged.** There is no row-level
      security policy, so any `psql` session, ad-hoc script or restored backup sees
      every tenant.

# Identity

- [ ] **Realm roles assigned.** A token carrying neither `shift-planner` nor
      `shift-viewer` can do nothing at all — not even read.
- [ ] **Imported users have `default-roles-shift`.** Keycloak adds realm-import
      users without the realm default role; omitting it lets them use the app but
      returns 403 from Keycloak's own account console. See
      [Gateway and identity](/architecture/gateway-and-identity.md).

# Optional but worth deciding

- [ ] **`SCAN_EXIT_CODE=1`** to make Trivy findings fail the pipeline rather than
      merely report. The image gate adds `--ignore-unfixed`, so it fires only on
      findings a base-image bump can resolve. See
      [Deployment and CI](/operations/deployment-and-ci.md).
- [ ] **MCP server behind HTTPS** with `MCP_OAUTH_CLIENT_ID`/`_SECRET` set, if
      external MCP clients need to connect. Both are blanked in the Compose stack
      because the OIDC library requires an HTTPS issuer URL.
- [ ] **`solver_time_limit_seconds` reviewed** for ward size. The default 120s
      returns `feasible` rather than `optimal` on large wards — usually fine, but a
      deliberate choice rather than an accident.
