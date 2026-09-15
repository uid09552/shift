---
type: Directory
title: Operations
description: Running the system — local development, configuration, database and migrations, deployment, CI, and the production checklist.
tags: [operations, devops, deployment]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
---

* [Local development](/operations/local-development.md) - prerequisites, the whole stack in Docker, or each piece individually. Ports at a glance.
* [Backend configuration](/operations/backend-configuration.md) - the four Figment layers, every setting, env vars and CLI flags.
* [Database and migrations](/operations/database-and-migrations.md) - PostgreSQL, the 24 migrations, the Diesel workflow, backups.
* [Deployment and CI](/operations/deployment-and-ci.md) - images, the Compose stack, the registry, GitLab CI, Trivy scanning, Renovate and Pages.
* [Production checklist](/operations/production-checklist.md) - what must be true before this faces real users.

# Fastest path

```bash
docker network create backend
docker network create dev_backend
cp deploy/.env.example deploy/.env
cd deploy && make up
```

# The one thing to get right

`tenant.dev_mode` must be **off** in production, and the backend must be reachable
**only** through APISIX. The backend trusts the JWT's `tenant` claim without
verifying its signature — that is safe behind the gateway and a cross-tenant data
leak in front of it. See [Tenant isolation](/architecture/tenant-isolation.md).
