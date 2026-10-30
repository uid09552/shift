---
type: Task Guide
title: Finding Cover When Someone Is Sick
description: Short-notice replacement — who can take an absent person's confirmed shift, ranked, and why everyone else cannot; assigning the cover marks the absence and notifies; on the Schedule page or by asking the assistant.
tags: [user-guide, replacement, sick, cover, absence, roster]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/shift-replacement/spec.md
    author: human:maxrg
    last_modified: 2026-10-08
  - resource: agent/shift_agent/agent/replacement.py
    author: human:maxrg
    last_modified: 2026-10-08
---

Someone calls in sick for tomorrow's early. Who can cover?

# On the Schedule page

Open the person's cell in the confirmed roster and choose **Find
replacement…**. The panel lists:

* **Who may take it**, best first. The ranking prefers, in this order: someone
  who **wished** for that shift, someone whose **preferred day off** it is not,
  someone furthest **below their hours target**, and then the most **rest**
  since their last shift. Each line shows how many people the shift will have
  against its minimum.
* **Everyone else, with the reason they are ruled out**: missing qualification,
  too little rest, recovery days after nights, too many days in a row, the
  weekly cap, the workstation's maximum, or a hard personal limit.

Nothing is written until you pick someone. Assigning marks the absent person
**sick, on leave or absent** and puts the colleague on the shift. It is a
normal roster write: in a published month it follows the
[roster lifecycle](/concepts/roster-lifecycle.md) — inside the freeze window
it asks for a reason — and each changed day becomes a
[change notice](/concepts/roster-change-notice.md) with the source
*replacement*, so both people are told.

# By asking the assistant

> *"Anna is sick tomorrow, who can take her shift?"*

The assistant works out tomorrow's date, runs the same search
(`findReplacement`) and lists the candidates with their reasons. It assigns only
after you pick a colleague and say yes, and it asks for a reason when the
freeze window needs one.

# Related

* Exchanging two shifts instead: [Shift swap request](/concepts/shift-swap.md)
* The rules behind the checks: [Constraint model](/solver/constraint-model.md)
