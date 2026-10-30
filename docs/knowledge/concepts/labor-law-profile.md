---
type: Domain Concept
title: Labor-Law Profile (ArbZG)
description: The planner setting labor_law_profile — none, or arbzg_de, which makes a modelled subset of German working-time law (ArbZG, JArbSchG for minors, MuSchG for maternity protection) hard for the solver and reports breaches separately in the plan check. A modelled subset, not legal advice.
resource: planner/shift_planner/legal.py
tags: [domain, labor-law, arbzg, jarbschg, muschg, compliance, breaks, rest]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-30T00:00:00Z
sources:
  - resource: openspec/specs/labor-law-profile/spec.md
    author: human:maxrg
    last_modified: 2026-10-25
---

`labor_law_profile` is a [planner setting](/concepts/planner-settings.md) for
the whole tenant, changed by planners and admins:

* **none** (default) — the ward's own settings (rest hours, consecutive days, …)
  are the only rules.
* **arbzg_de** — the solver also holds a rule set taken from German law as
  **hard** rules, and wherever a ward setting is stricter, the stricter one wins.
  A planner's note to the repair cannot switch it off for one run.

**This is a modelled subset of the law, not legal advice.** It covers the rules
below and nothing more; whether a roster is lawful is still for the ward to
judge.

# What arbzg_de enforces

**Everyone (ArbZG)**

* at most **10 hours a day**, counted net of the shift's `break_minutes`;
* at most **48 hours a week on average** over `labor_law_averaging_weeks`
  (default 24), counting the confirmed history before the period;
* at least **11 hours of rest** between shifts;
* **breaks**: a shift over 6 hours needs at least 30 break minutes, over 9 hours
  at least 45 — a shift the plan uses with less is reported once.

**Under 18 on the day (JArbSchG)**, from the stored date of birth: at most 8
hours a day and 40 a week, at most 5 days a week, 12 hours' rest, no night
shift, no Sunday or public holiday.

**Maternity protection (MuSchG)**: no work between 20:00 and 06:00, no Sunday
or public holiday, at most 8.5 hours a day.

The data behind the last two lives in [personal limits](/concepts/personal-limits.md)
and is visible only to planners and admins. Results, findings and the audit
log never say *why* someone is protected — only which law a finding breaks.

# In the plan check and on the way to the roster

The plan check (*Verify Plan*, `validateOptimizedPlan`) returns legal findings
in their own `legal` section — the profile, a `compliant` flag and each finding
with its statute — separate from the soft-goal warnings. *Take as Plan* and
publishing warn when a plan has legal findings, but do not refuse.

The rules live in `planner/shift_planner/legal.py`, copied byte for byte to
the agent's plan check; a test fails if the two drift apart.
