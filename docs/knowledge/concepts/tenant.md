---
type: Domain Entity
title: Tenant
description: The isolation boundary — every table carries tenant_id and every repository method takes it as its first argument. The UI calls it an organisation.
resource: src/services/tenant.rs
tags: [domain, multi-tenancy, security]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/auth.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: migrations/00000000000018_add_tenant_id
    author: human:maxrg
    last_modified: 2026-07-31
---

A tenant is one hospital or ward whose data is completely separated from every
other. Users pick one at sign-in; the UI calls it an **organisation**.

There is no `tenants` table. A tenant is a string identifier carried on every
row, originating from the `tenant` claim of the signed-in user's JWT. Migration
18 added `tenant_id` across the entire schema.

# How it is resolved

`authenticate` in `src/services/tenant.rs` wraps the whole `/api/v1` subtree:

1. **Dev mode** — the configured `tenant.tenant_id` is used and no token is
   needed.
2. **Otherwise** — the request must carry `x-access-token` with a JWT whose
   `tenant` claim is an array; the first entry wins. Missing or undecodable
   tokens are rejected with **401**, never falling back to a default.

Handlers read it through the `TenantContext` extractor, which likewise has no
fallback: a request that somehow reached a handler unresolved fails rather than
operating on someone else's data.

# How it is enforced

Not in the database. There is no row-level security policy. Isolation lives in
the repository layer, where every method takes `tenant_id` as its **first
parameter**:

```rust
async fn list_employees(&self, tenant_id: &str) -> Result<Vec<Employee>, Error>;
```

Scoping is therefore a parameter you cannot omit rather than a `WHERE` clause you
might forget. The consequence is that anything bypassing the repositories — a
`psql` session, an ad-hoc script, a backup — sees every tenant. Treat direct
database access as privileged.

The reasoning behind this placement is in
[Tenant isolation](/architecture/tenant-isolation.md).

# Dev mode disables it

`tenant.dev_mode: true` pins every unauthenticated request to the configured
tenant. It exists so the API is usable with plain `curl` and so `seed_data_v2.py`
works without a gateway. It removes authentication *and* tenant separation, and
must never be enabled on a shared or production deployment. See
[Production checklist](/operations/production-checklist.md).

# Related

* The whole chain: [Gateway and identity](/architecture/gateway-and-identity.md)
* Per-tenant solver config: [Planner settings](/concepts/planner-settings.md)
* Who changed what: [Audit log](/concepts/audit-log.md)
