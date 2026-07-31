# Shift Planner

A hospital shift management system: it takes the people, the skills, the
workstations and the shift definitions of a hospital ward, and produces a
staffing plan that respects labour rules and balances the load across the team.

Planning a ward by hand means juggling qualifications, rest periods, monthly
hour targets, holidays and the fact that the ICU has to be staffed before the
outpatient desk. This system models all of that explicitly and hands the
combinatorics to a constraint solver, leaving the planner to review, adjust and
confirm the result.

## The four services

| Service | Language | Role |
|---|---|---|
| **Backend** | Rust (Axum + Diesel) | REST API, PostgreSQL persistence, tenant isolation, audit trail |
| **Planner** | Python (OR-Tools CP-SAT) | Solves the scheduling problem; reachable over HTTP or NATS JetStream |
| **UI** | Angular 21 + Tailwind | Calendars, configuration screens, scheduling workbench |
| **Agent / MCP** | Python (LangGraph + FastMCP) | Chat assistant that drives the app through MCP tools generated from the OpenAPI spec |

They sit behind an APISIX gateway that terminates OIDC against Keycloak, and
run on PostgreSQL and NATS.

```mermaid
flowchart LR
    Browser -->|OIDC session| APISIX
    APISIX --> UI[Angular UI]
    APISIX --> Backend[Rust backend]
    APISIX --> Agent[Chat agent]
    Agent --> MCP[MCP server]
    MCP --> Backend
    Backend --> PG[(PostgreSQL)]
    Backend <-->|JetStream| NATS[(NATS)]
    NATS <--> Planner[CP-SAT optimizer]
```

## Where to go next

!!! tip "Using the software rather than building it?"
    Start with the **[User Guide](guide/index.md)** — a non-technical,
    illustrated walkthrough of every screen, written for ward managers and
    staffing coordinators. Everything below is documentation for developers
    and administrators.

<div class="grid cards" markdown>

- **[User Guide](guide/index.md)** — what the software is for and how to run a
  ward with it, screen by screen.
- **[Architecture](architecture.md)** — how the pieces fit together and how a
  plan flows through them.
- **[Getting Started](getting-started.md)** — run the whole stack locally.
- **[Domain Model](domain-model.md)** — employees, shifts, capabilities,
  workstations and plans.
- **[REST API](api.md)** — every endpoint the backend exposes.
- **[Optimizer](planner.md)** — the constraint model and its tunable weights.
- **[Agent & MCP](agent.md)** — the chat assistant and the generated tool surface.
- **[Auth & Multi-Tenancy](auth.md)** — how a request is scoped to a tenant.
- **[Deployment](deployment.md)** — Docker Compose, the registry, and CI.

</div>

## Status of this documentation

These pages describe the system as it stands in the `main` branch. The
authoritative sources are `api/openapi.yaml` for the HTTP surface,
`src/schema.rs` and `migrations/` for the data model, and
`planner/shift_planner/models.py` for the optimizer's input contract — where
this documentation and those files disagree, the files win.
