## 1. Database and backend

- [ ] 1.1 Migration for `shift_swap_requests` (with down) and `schema.rs`
- [ ] 1.2 Model, repository trait and Postgres repository (tenant id first)
- [ ] 1.3 Service: create, accept/decline, cancel, approve/reject, list, pending count, lazy expiry
- [ ] 1.4 Ownership checks by e-mail; role gating per action
- [ ] 1.5 Add `shift-swaps` to `SELF_SERVICE_SEGMENTS`
- [ ] 1.6 Transactional approval with stale check and audit entry
- [ ] 1.7 Handlers, routes and `api/openapi.yaml`

## 2. Agent

- [ ] 2.1 Read-only exchange check endpoint reusing replacement rules
- [ ] 2.2 Backend call to the agent to attach warnings to the request detail
- [ ] 2.3 Tests in `agent/tests/`

## 3. UI

- [ ] 3.1 Viewer: request swap from own shift, my requests, cancel
- [ ] 3.2 Colleague: incoming requests, accept/decline
- [ ] 3.3 Planner: review with warnings, approve/reject
- [ ] 3.4 Header notification with pending count, planner/admin only
- [ ] 3.5 i18n labels in `en.ts` and `de.ts`; `data-testid` attributes

## 4. Tests and docs

- [ ] 4.1 Rust tests in `tests/` for roles, ownership, flow, stale, expiry, tenant isolation
- [ ] 4.2 Robot e2e for the request-accept-approve flow
- [ ] 4.3 Update docs (domain-model, api, database, frontend, guide, knowledge) and tick item 8 in `todo.txt`
