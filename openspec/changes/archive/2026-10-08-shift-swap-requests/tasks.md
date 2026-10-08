## 1. Database and backend

- [x] 1.1 Migration for `shift_swap_requests` (with down) and `schema.rs`
- [x] 1.2 Model, repository trait and Postgres repository (tenant id first)
- [x] 1.3 Service: create, accept/decline, cancel, approve/reject, list, pending count, lazy expiry
- [x] 1.4 Ownership checks by e-mail; role gating per action
- [x] 1.5 Add `shift-swaps` to `SELF_SERVICE_SEGMENTS`
- [x] 1.6 Transactional approval with stale check and audit entry
- [x] 1.7 Handlers, routes and `api/openapi.yaml`

## 2. Agent

- [x] 2.1 Read-only exchange check endpoint reusing replacement rules
- [x] 2.2 Backend call to the agent to attach warnings to the request detail
- [x] 2.3 Tests in `agent/tests/`

## 3. UI

- [x] 3.1 Viewer: request swap from own shift, my requests, cancel
- [x] 3.2 Colleague: incoming requests, accept/decline
- [x] 3.3 Planner: review with warnings, approve/reject
- [x] 3.4 Header notification with pending count, planner/admin only
- [x] 3.5 i18n labels in `en.ts` and `de.ts`; `data-testid` attributes

## 4. Tests and docs

- [x] 4.1 Rust tests in `tests/` for roles, ownership, flow, stale, expiry, tenant isolation
- [x] 4.2 Robot e2e for the request-accept-approve flow
- [x] 4.3 Update docs (domain-model, api, database, frontend, guide, knowledge) and tick item 8 in `todo.txt`
