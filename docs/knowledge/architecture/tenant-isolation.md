---
type: Design Decision
title: Tenant Isolation in the Repository Layer
description: Why tenant scoping is the first parameter of every repository method rather than a database row-level security policy — and what that costs.
resource: src/repository/domain.rs
tags: [architecture, decision, multi-tenancy, security]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/auth.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: src/repository/domain.rs
    author: human:maxrg
    last_modified: 2026-07-31
---

# Decision

Every table carries `tenant_id`, and **every repository method takes `tenant_id`
as its first argument**:

```rust
async fn list_employees(&self, tenant_id: &str) -> Result<Vec<Employee>, Error>;
```

There is no row-level security policy in PostgreSQL and no "global" row anywhere
in the schema.

# Rationale

Scoping expressed as a required parameter is something the compiler enforces. A
`WHERE tenant_id = $1` clause is something a developer remembers — and a
cross-tenant data leak is exactly the class of bug that a code review catches
four times out of five. Making it a signature requirement removes the fifth.

The same logic runs through the layer above. `authenticate` wraps the entire
`/api/v1` subtree rather than being applied per route, so a new endpoint is
protected by default. The `TenantContext` extractor deliberately has **no
fallback** to the configured default tenant: a request that somehow reached a
handler without resolution fails with 401 rather than quietly operating on
someone else's data. Failing closed at three levels is cheap; leaking once is not.

# Consequences

**Anything bypassing the repositories sees everything.** A `psql` session, an
ad-hoc migration script, a backup, a reporting tool wired straight to the
database — none of them are scoped. Direct database access is privileged access
and should be treated as such. A row-level security policy would have covered
those paths; this design does not.

**Dev mode disables it wholesale.** `tenant.dev_mode: true` pins every
unauthenticated request to a configured tenant so `curl` and `seed_data_v2.py`
work without a gateway. It removes authentication *and* separation together.

**The backend must sit behind the gateway.** It decodes the JWT payload without
verifying the signature, trusting APISIX to have done so. Publishing it directly
makes the `tenant` claim forgeable, at which point none of the above matters. See
[Gateway and identity](/architecture/gateway-and-identity.md).

# Related

* [Tenant](/concepts/tenant.md) - the entity and its resolution rules
* [Backend service](/architecture/backend-service.md) - where the layers sit
* [Production checklist](/operations/production-checklist.md) - the deployment consequences
