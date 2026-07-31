---
type: Service
title: Gateway and Identity
description: APISIX terminating OIDC against Keycloak — routes, the two headers it injects, realm roles, and the token chain through the agent.
resource: deploy/gateway/apisix_conf/apisix-standalone.yaml
tags: [architecture, auth, apisix, keycloak, security]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/auth.md
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: deploy/gateway/apisix_conf/apisix-standalone.yaml
    author: human:maxrg
    last_modified: 2026-07-25
---

Authentication happens at the edge; tenant isolation happens in the data access
layer. Neither is the other's job, and knowing where the line sits explains most
of the security model.

```mermaid
sequenceDiagram
    participant B as Browser
    participant G as APISIX
    participant K as Keycloak
    participant BE as Backend

    B->>G: GET /planner/
    G->>K: OIDC authorization code flow
    K-->>G: id/access token
    G-->>B: session cookie
    B->>G: GET /api/v1/employees (cookie)
    G->>BE: + X-Access-Token, X-Userinfo
    BE->>BE: authenticate reads `tenant` and `realm_access.roles`
    BE-->>G: rows for that tenant only
```

# Routes

APISIX runs in standalone mode from
`deploy/gateway/apisix_conf/apisix-standalone.yaml`:

| Route | Purpose |
|---|---|
| `/` | Redirect to `/planner/` |
| `/auth/*` | Keycloak itself |
| `/planner/*` | The Angular UI, behind `openid-connect` |
| `/api/*` | The backend, behind `openid-connect` |
| `/agent/*` | The chat agent, rewritten to `/api/v1/*` |
| `/callback`, `/logout` | OIDC callback and logout |
| `/images/*` | Static assets |
| `/echo/*` | A request-echo service for verifying routing and headers |

# The two headers

The `openid-connect` plugin sets both on every upstream request:

* **`X-Access-Token`** — the raw JWT. The backend reads its `tenant` and
  `realm_access.roles` claims; the agent forwards it onward.
* **`X-Userinfo`** — base64 JSON, decoded by `GET /api/v1/self`.

# The backend does not verify the signature

The middleware decodes the JWT **payload only**. Signature and expiry are
verified by APISIX before the request arrives. The consequence is a hard
deployment rule: **the backend must never be published directly** — anything that
can reach it can forge a `tenant` claim and read another hospital's roster. See
[Production checklist](/operations/production-checklist.md).

# Roles

Read from `realm_access.roles` by the same middleware:

| Role | May do |
|---|---|
| `shift-planner` | Every method — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `shift-viewer` | `GET`/`HEAD` only |

Anything else in `realm_access.roles` is ignored. A method the caller's roles do
not cover is rejected with **403** before the handler runs, so read-only access is
enforced in one place rather than per route. A token with neither role can do
nothing at all — not even read. In dev mode there is no token and every request
is treated as a planner.

Handlers that need to vary behaviour take the `RoleContext` extractor
(`can_read()` / `can_write()`); most do not, because the middleware has already
decided. Roles are defined in `deploy/iam/realm-shift.json`.

## default-roles-<realm> on imported users

Users listed in a realm import must include `default-roles-shift` in their
`realmRoles` alongside the app roles. Keycloak adds imported users **without** the
realm's default role — unlike users created through the admin console or
registration — and `default-roles-shift` is what composites in the `account`
client's `view-profile` / `manage-account`. Leave it out and the user signs in to
the app normally but gets **403** from Keycloak's own account console at
`/auth/realms/shift/account/`.

Existing users are unaffected by editing the template; grant it in the admin
console (Users → Role mapping) or with:

```bash
kcadm.sh add-roles -r shift --uusername <user> --rolename default-roles-shift
```

# The agent's token chain

One token, the user's, travels the whole way:

1. **Into the agent** — `agent/server.py` takes it from `X-Access-Token` (set by
   APISIX on `/agent/*`, falling back to the `Authorization` bearer for local
   testing), verifies it against Keycloak's JWKS, and stores it in a contextvar
   for that `graph.invoke()` call.
2. **Agent → MCP** — `agent/client.py` reads it back on every tool call and sends
   it as `Authorization: Bearer`.
3. **MCP → backend** — `mcp/auth.py` attaches it to the backend call.
4. **Fallback** — `BACKEND_ACCESS_TOKEN`, a static token for cases with no
   per-request token: terminal chat, stdio transport, single-tenant deployments.

## MCP server auth

With `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` set, the HTTP MCP server
verifies incoming clients itself via `MultiAuth`: external clients can use
Keycloak's authorization code grant with Dynamic Client Registration
(`OIDCProxy`), or present an existing bearer token (`JWTVerifier`; `make
mcp-token` fetches one).

In `deploy/docker-compose.yml` both are deliberately blanked for the `mcp`
service, because the OIDC library requires an HTTPS issuer URL that `MCP_BASE_URL`
isn't. The server then verifies nothing of its own and forwards the caller's
header as-is — APISIX and the backend still validate it. Put the MCP server behind
HTTPS and set both to re-enable its own verification.

# Identity provider

Keycloak runs in `deploy/iam/docker-compose.yml` (version 26.2, own PostgreSQL) at
`KC_HTTP_RELATIVE_PATH=/auth`, reachable through APISIX at `/auth/*`, importing
`deploy/iam/realm-shift.json`. It is kept separate from the main stack so the IdP
can be brought up and torn down independently.

`iam/bootstrap.sh` is a separate script targeting **Zitadel** — an alternative IdP
setup, not the one the Compose stack uses.

# Related

* [Tenant](/concepts/tenant.md), [Tenant isolation](/architecture/tenant-isolation.md)
* [Audit log](/concepts/audit-log.md)
