# Auth & Multi-Tenancy

Authentication happens at the edge; tenant isolation happens in the data
access layer. Neither is the other's job, and understanding where the line sits
is the point of this page.

## The chain

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
    BE->>BE: authenticate reads the `tenant` and `realm_access.roles` claims
    BE-->>G: rows for that tenant only
```

## The gateway

APISIX (`deploy/gateway/apisix_conf/apisix-standalone.yaml`) runs in standalone
mode and terminates OIDC against Keycloak for every protected route:

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

The `openid-connect` plugin sets two headers on the upstream request:

- **`X-Access-Token`** — the raw JWT. The backend reads its `tenant` and
  `realm_access.roles` claims; the agent forwards it to its own MCP tool calls.
- **`X-Userinfo`** — base64 JSON, decoded by `GET /api/v1/self`.

## Tenant resolution

`authenticate` in
[`src/services/tenant.rs`](https://gitlab.com/uid09552/shift/-/blob/main/src/services/tenant.rs)
wraps the entire `/api/v1` subtree:

1. **Dev mode** — the configured `tenant_id` is used, no token needed.
2. **Otherwise** — the request must carry `x-access-token` with a JWT whose
   `tenant` claim is an array; the first entry wins. Missing or undecodable
   tokens are rejected with **401**, never falling back to the default tenant.

The middleware puts the result in the request extensions; handlers pull it out
via the `TenantContext` extractor, which also has no default. A request that
somehow reached a handler without resolution fails rather than operating on
someone else's data.

!!! note "The backend does not verify the signature"
    The middleware decodes the JWT payload only. Signature and expiry are
    verified by APISIX before the request ever arrives. **The backend must
    therefore never be exposed directly** — anything that can reach it can
    forge a `tenant` claim. Publish it only through the gateway.

## Roles

The same middleware reads the realm roles from the token:

```json
"realm_access": { "roles": ["shift-planner"] }
```

| Role | May do |
|---|---|
| `shift-planner` | Every method — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `shift-viewer` | `GET`/`HEAD` only |

Anything else in `realm_access.roles` is ignored. A method the caller's roles do
not cover is rejected with **403** before the handler runs, so read-only access
is enforced in one place rather than per route. A token with neither role can do
nothing at all — not even read.

In dev mode there is no token, so every request is treated as a planner.

Handlers that need the roles themselves take the `RoleContext` extractor
(`can_read()` / `can_write()`); most do not, because the middleware has already
decided. The roles are defined in the realm
(`deploy/iam/realm-shift.json`) and assigned to users there.

## Isolation in the data layer

Every table carries `tenant_id`, and every repository method takes it as its
first argument:

```rust
async fn list_employees(&self, tenant_id: &str) -> Result<Vec<Employee>, Error>;
```

Scoping is a parameter you cannot omit, not a `WHERE` clause you might forget.
There is no row-level security policy in PostgreSQL, which means direct
database access — psql, ad-hoc scripts, backups — sees every tenant. Treat it
as privileged.

## Dev mode

```bash
make serve DEV=1 TENANT_ID=0
```

Sets `tenant.dev_mode = true`, so every request is scoped to `TENANT_ID` with
no token at all. That is what makes `curl` and `seed_data_v2.py` work without a
gateway.

!!! danger
    Dev mode removes authentication *and* tenant separation. It is for local
    development only.

## The agent's token chain

The signed-in user's token travels the whole way, so every call runs as that
user rather than as a service account:

1. **Into the agent** — `agent/server.py` takes the token from `X-Access-Token`
   (set by APISIX on the `/agent/*` route; falling back to the `Authorization`
   bearer for local testing), verifies it against Keycloak's JWKS, and stores it
   in a contextvar for that `graph.invoke()` call.
2. **Agent → MCP server** — `agent/client.py` reads it back on every tool call
   and sends it as `Authorization: Bearer`.
3. **MCP server → backend** — `mcp/auth.py` attaches it to the backend call.
4. **Fallback** — `BACKEND_ACCESS_TOKEN`, a single static token used where no
   per-request token exists: terminal chat, stdio transport, single-tenant
   deployments.

### MCP server auth

With `MCP_OAUTH_CLIENT_ID` / `MCP_OAUTH_CLIENT_SECRET` set, the HTTP MCP server
verifies incoming clients itself via `MultiAuth`: external MCP clients can use
Keycloak's authorization code grant with Dynamic Client Registration
(`OIDCProxy`), or present an existing bearer token directly (`JWTVerifier`;
`make mcp-token` fetches one).

In `deploy/docker-compose.yml` both are deliberately blanked for the `mcp`
service, because the OIDC library requires an HTTPS issuer URL that
`MCP_BASE_URL` isn't. The server then verifies nothing of its own and forwards
the caller's header as-is — APISIX and the backend still validate it. Put the
MCP server behind HTTPS and set both to re-enable its own verification.

## Identity provider

Keycloak runs in the Compose stack at `KC_HTTP_RELATIVE_PATH=/auth`, reachable
through APISIX at `/auth/*`. The realm definition is
`deploy/iam/realm-shift.json`.

`iam/bootstrap.sh` is a separate script targeting **Zitadel** (organisation,
project, OIDC application, and the matching APISIX routes) — an alternative
identity provider setup, not the one the Compose stack uses.

## Audit trail

Mutating operations record an entry in `audit_logs` with the actor, action,
entity and a JSON diff. Read it with `GET /api/v1/audit-logs`; it is
tenant-scoped like everything else, and cannot be written through the API.
