---
type: Directory
title: Architecture
description: The services, data stores, the asynchronous planning pipeline, and the three design decisions that explain most of the system's behaviour.
tags: [architecture, services]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
---

Four services around one relational database, behind one gateway. The Rust
backend owns all persistent state; **every other component talks to the backend,
never to PostgreSQL directly.**

Start with [System overview](/architecture/system-overview.md) for the shape,
then [Planning pipeline](/architecture/planning-pipeline.md) for the flow that
matters most. If something in the system's behaviour seems arbitrary, the answer
is usually in one of the three decisions at the bottom of this page.

## Overview

* [System overview](/architecture/system-overview.md) - the four services, the two stores, the gateway, and the technology choices with their rationale.

## Services

* [Backend service](/architecture/backend-service.md) - Rust, Axum, Diesel. Hexagonal layering, request lifecycle, startup sequence.
* [Optimizer service](/architecture/optimizer-service.md) - Python, OR-Tools CP-SAT. Stateless: JSON in, JSON out.
* [UI application](/architecture/ui-application.md) - Angular 21 SPA, routes, one HTTP service per resource.
* [Agent and MCP service](/architecture/agent-and-mcp-service.md) - LangGraph chat agent over an MCP tool surface generated from the OpenAPI spec.
* [Gateway and identity](/architecture/gateway-and-identity.md) - APISIX terminating OIDC against Keycloak; roles, headers, and the token chain.

## Stores

* [Data stores](/architecture/data-stores.md) - PostgreSQL 17 as the system of record, NATS JetStream as the durable hand-off to the solver.

## Flows

* [Planning pipeline](/architecture/planning-pipeline.md) - from "Calculate Plan" to a confirmed roster, end to end.

## Decisions

Three choices that account for most of the surprising behaviour:

* [Tenant isolation in the repository layer](/architecture/tenant-isolation.md) - why scoping is a function parameter and not a database policy.
* [Soft minimum, hard maximum](/architecture/soft-minimum-hard-maximum.md) - why understaffing is a penalty and overstaffing is impossible.
* [Spec-driven tool surface](/architecture/spec-driven-tool-surface.md) - why the agent has no hand-written backend tools.
