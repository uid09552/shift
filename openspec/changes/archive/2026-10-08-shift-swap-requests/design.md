## Context

See proposal.md. A `shift-viewer` is already allowed to mutate paths listed in `SELF_SERVICE_SEGMENTS` (`services/tenant.rs`), and handlers check ownership by matching the employee's e-mail against the token (`UserContext::matches_email`), as `shift_wish.rs` does. The agent's `blocking_reason` rules (`agent/shift_agent/agent/replacement.py`) already encode the checks needed for warnings.

## Goals / Non-Goals

**Goals:** a two-step consent and approval flow; warnings for the planner; planner-only notification; audit trail.
**Non-Goals:** open shifts, e-mail/push, blocking rules, qualification checks at request time.

## Decisions

- **Table `shift_swap_requests`** (tenant_id, requester_id, colleague_id, requester_date/shift/workstation, colleague_date/shift/workstation, status, decided_by, timestamps). Roster rows are referenced by value, not FK, so a stale check can compare them to the current roster at approval.
- **Self-service path**: add `shift-swaps` to `SELF_SERVICE_SEGMENTS`. Handlers enforce who may do what: creating and cancelling is requester-only, accept/decline is colleague-only, approve/reject is `can_write()` roles only. Alternative of separate planner paths was rejected as it duplicates routing.
- **Role gating**: planners cannot create requests, so the flow never bypasses the colleague's consent.
- **Warnings via the agent**: a read-only agent endpoint checks an exchange and reuses the replacement blocking rules; the backend returns the warnings with the request detail. They never gate approval. Alternative of reimplementing rules in Rust was rejected to keep one rule source.
- **Approval is transactional**: re-read both roster rows, compare with the stored values, swap them in one transaction, write the audit entry. Mismatch gives a stale refusal.
- **Expiry** is computed on read (status derived when the date has passed) and persisted lazily, avoiding a scheduler.
- **Notification**: the planner UI polls a count of `pending_planner` requests and shows it in the header notification dropdown, rendered only for planner/admin roles. No server push.

## Risks / Trade-offs

- Warning-only rules let a planner approve a rule-breaking roster; this is intended and recorded in the audit entry (warnings present).
- No qualification check may place an unqualified person on a workstation; the planner warning is the only safeguard.
- Polling adds light load; acceptable at this scale.
- Employee-to-user mapping by e-mail inherits the existing wish limitation.

## Open Questions

- Whether a swap may cross workstations (assumed yes, since qualification is not validated).
