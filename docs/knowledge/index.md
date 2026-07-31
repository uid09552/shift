---
okf_version: "0.2"
type: Knowledge Bundle
title: Shift Planner Knowledge Bundle
description: Curated agent-readable knowledge about the Shift Planner hospital rostering system — domain concepts, architecture, interfaces, solver model, user workflows and operations.
resource: https://gitlab.com/uid09552/shift
tags: [shift-planner, hospital, rostering, okf]
status: stable
generated:
  by: claude-code/claude-opus-5
  at: 2026-07-31T00:00:00Z
sources:
  - resource: docs/
    author: human:maxrg
    last_modified: 2026-07-31
  - resource: CLAUDE.md
    author: human:maxrg
    last_modified: 2026-07-31
---

Shift Planner is a multi-tenant hospital shift management system. It models a
ward — its staff, qualifications, shift types and workstations — and hands the
combinatorics of building a duty roster to a CP-SAT constraint solver. A human
planner reviews the proposal and confirms it; nothing the solver produces takes
effect until someone presses **Take as Plan**.

Four services around one PostgreSQL database: a Rust backend that owns all
persistent state, a Python optimizer, an Angular UI, and a LangGraph chat agent
that drives the backend through an MCP tool surface generated from the OpenAPI
spec.

## How to use this bundle

Each `.md` file below is one concept. Start at the directory `index.md` closest
to your question and follow links rather than loading the whole bundle. Links
starting with `/` are bundle-relative.

Route by question shape:

| If you are asking… | Start at |
|---|---|
| What does this word mean? | [Glossary](/glossary.md) |
| What is this thing in the model? | [Concepts](/concepts/index.md) |
| How do the pieces fit together? | [Architecture](/architecture/index.md) |
| What can I call, and with what payload? | [Interfaces](/interfaces/index.md) |
| Why did the solver decide that? | [Solver](/solver/index.md) |
| How does a ward manager do X? | [User Guide](/guide/index.md) |
| How do I run, configure or deploy it? | [Operations](/operations/index.md) |

## Directories

### Domain

* [Concepts](/concepts/index.md) - the fourteen entities the system plans with: employees, capabilities, shifts, workstations, absences, plans and tenancy.

### System

* [Architecture](/architecture/index.md) - the services, the data stores, the planning pipeline, and the three design decisions that explain most of the rest.
* [Interfaces](/interfaces/index.md) - REST API, optimizer JSON contract, NATS subjects, MCP tool surface, spreadsheet import/export.
* [Solver](/solver/index.md) - the constraint model, the objective terms, every tunable setting, and how to diagnose an infeasible run.

### People

* [User Guide](/guide/index.md) - the ward manager's workflow, screen by screen, in non-technical language.

### Running it

* [Operations](/operations/index.md) - local development, configuration, database and migrations, deployment, CI and the production checklist.

## Authority

Where this bundle and the repository disagree, the repository wins. The
authoritative sources are `api/openapi.yaml` for the HTTP surface, `src/schema.rs`
and `migrations/` for the data model, `planner/shift_planner/models.py` for the
optimizer contract, and `src/config.rs` for backend configuration.

This bundle is derived from the prose documentation in `docs/` (published with
MkDocs) and from those files directly. It is a parallel, agent-oriented view of
the same system — not a replacement for the human-facing site.

See [Update log](/log.md).
