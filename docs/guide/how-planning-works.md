# How the automatic planner decides

You do not need to read this page to use the software. Read it when the
planner produces something you disagree with and you want to know why — or
when you want to change how it thinks.

## The short version

The planner is not clever, and it is not guessing. It works like an extremely
patient colleague who tries millions of rosters, throws away every one that
breaks a rule, gives each of the survivors a score, and hands you the best
one it found before the clock ran out.

So there are two kinds of thing you can tell it:

- **Rules it must never break.** These simply eliminate rosters.
- **Things it should try to do well.** These are scored, and the planner
  trades them off against each other.

Almost every surprise comes from the second kind. When two goals conflict —
and on a short-staffed ward they always do — the planner has to sacrifice one.
Which one it sacrifices is something you control.

---

## The rules it will never break

These come from your setup, not from a settings page. A roster violating any
of them is not produced at all.

| Rule | Where it comes from |
|---|---|
| Nobody works two shifts on the same day | Built in |
| Nobody works at two places in one shift | Built in |
| Nobody exceeds a workstation's **Max** staffing | [Workstation](setup.md#3-workstations) |
| Nobody exceeds a shift's **Max** staffing | [Shift weekday times](setup.md#weekday-times) |
| People only work shifts they are **available** for | [Employee](people.md#available-shifts) |
| People only work where they hold **every required capability** | [Employee](people.md#capabilities) / [Workstation](setup.md#3-workstations) |
| Nobody is scheduled on a **hard absence** | [Employee](people.md#leave-and-unavailability) |
| Closed workstations are not staffed — deactivated ones, or ones inside a closed period. Nor can anyone be put there by hand, and a proposal that staffs one cannot be taken as the plan | [Deactivating a workstation](setup.md#deactivating-a-workstation) |
| Compulsory rest days after a shift are honoured | *Free days after* on the shift |
| Minimum rest between two days' shifts | *Minimum rest (hours)* setting |
| The cap on consecutive working days | *Max consecutive days* setting |
| The cap on working days per week | *Max days per week* setting |

!!! important "Minimum staffing is not on this list"
    **Max** staffing is a hard rule; **Min** is a goal. If minimums were hard
    rules, one bad flu week would give you the word "impossible" and no
    roster. Instead the planner fills what it can, and the shortfall shows up
    as a thin day you can see and act on.

## The things it tries to do well

**Your fixed days come first.** Shifts and days off fixed for someone — by a
[rotation](creating-a-plan.md#fixed-rhythms-rotations), or one at a time — are
kept before anything else, as long as no rule forbids them. One that clashes
(two nights in a row with two recovery days required, say) is left out and
listed with the result; it never stops a plan being made.

**Covering the posts comes next.** The planner then fills as many
minimum-staffing slots as the rules allow — high-priority workstations first
when staff run short. Only then does it polish the roster, and it never
gives back a filled slot to do so. Any slot still short is listed with the
result, with the reason: *not enough staff left*, or *nobody qualified and
available* (nobody in your data could ever take it — check capabilities and
available shifts).

Everything below is then scored. The planner adds up the scores of a candidate
roster and keeps the best total.

| Goal | What it means in practice |
|---|---|
| **Be fair** | Spread working hours evenly. This is weighted very heavily — it is why the planner refuses to let one person absorb all the awkward shifts. |
| **Hit contracted hours** | Land each person near their monthly target. Going over and going under are penalised equally. |
| **Respect the weekly band** | If you set one, keep everyone between a minimum and maximum number of hours in any 7 days. |
| **Grant preferences** | Honour soft "rather not work" days and shift wishes. |
| **Don't waste seniority** | Avoid covering a junior post with a senior person, where you have set up skill groups and levels. |
| **Share out the hard shifts** | Track how tiring each person's schedule is — nights count double — and protect the *worst-off* person rather than the average. |
| **Keep shifts consistent** | Reward giving someone the same shift several days running, with a bonus for a full week. Rotating people daily is legal but horrible. |

Two of these deserve a note.

**Fairness is deliberately loud.** Its weight is far higher than most others,
which encodes a priority order: the planner will give up wishes and shift
continuity to avoid dumping a fortnight of nights on one person. It will not
leave a post short for it — coverage is settled before fairness is scored.

**Fatigue protects the worst-off, not the average.** An average-based measure
is perfectly happy to wreck one person's month as long as the team's mean
looks acceptable. This one is not.

---

## The settings page

**Configuration → Planner Settings.** These apply to every calculation from
now on, for your organisation.

![The Planner Settings page: use-case presets at the top, then one section per
group of goals](../assets/screenshots/planner-settings.png)

!!! warning "Change one thing at a time"
    These settings interact. If you change four values and the next roster
    looks worse, you will have no idea which one did it. Change one,
    recalculate, compare, then move on. The **Compare** tab of the Schedule
    Optimizer shows two runs side by side for exactly this.

### Use case: start from a preset

The six cards at the top are starting points. Picking one fills in every
setting below it; nothing is saved until you press **Save Changes**, and every
value stays editable afterwards. Solver performance and **Keep rotations** are
never touched by a preset.

| Preset | What it favours |
|---|---|
| **Balanced** | The shipped defaults: coverage, fairness and wishes weighed against each other. |
| **Equal share** | Everyone works a comparable amount. Hour targets win over wishes and shift continuity. |
| **Wishes first** | Requested shifts are granted whenever the plan allows, at some cost to even hours. |
| **Coverage first** | Critical workstations are staffed before anything else. Rest limits are looser (1 recovery day after nights, 10 h rest, up to 7 days in a row, 6 per week). |
| **Stable rosters** | Long, predictable blocks on the same shift instead of frequent rotation. |
| **Staff wellbeing** | Longer rest (3 recovery days, 12 h), at most 5 days in a row, a 45 h weekly ceiling, and fatigue spread evenly. The gentlest plan the ward allows. |

The line under the cards says which preset the current values match, or
*Custom mix* once you have changed something. The four small meters beside it
(Fairness, Wishes, Coverage, Stability) show at a glance where the current mix
leans.

### Levels instead of numbers

Every weighting is offered as a named level: **Off**, **Weak**, **Balanced**,
**Strong** or **Very strong**. *Balanced* is always the shipped default for
that setting. The bars beside each dropdown show the same level visually.

Behind the levels are the raw weights the optimizer uses. Switch on **Expert
values** (top right) to see and type them directly. A value typed by hand that
matches no level is shown as *Custom (value)*.

!!! note "Why the numbers are so far apart"
    In expert view you will see a fairness weight of 50 000 next to a fatigue
    weight of 100. The wide gaps make the goals effectively rank-ordered
    inside a single score. Changing a weight by a factor of ten does not tune
    it slightly; it can change which goal wins outright. That is why the
    levels exist.

### Rest & Recovery

Hard limits: the ones with legal and contractual weight. Each is a slider.

| Setting | Default | What it does |
|---|---|---|
| **Night shift recovery** | 2 days | Days off compulsory after a night shift. `0` switches it off. |
| **Minimum rest between shifts** | 11 h | Rest required between shifts on consecutive days. This is what prevents a late shift followed by an early one. `0` switches it off. |
| **Max consecutive days** | 6 days | The longest run of working days anyone may be given. `0` switches it off. |
| **Max days per week** | 5 / week | Working days allowed per calendar week. `0` switches it off. |

Tightening any of these makes the roster harder to fill; tighten all four at
once on a thin ward and you may get *infeasible*.

### Fairness & Hours

| Setting | Default | What it does |
|---|---|---|
| **Fairness** | Balanced | How hard to spread hours evenly. Raise it if the roster feels lopsided; lower it if it keeps overriding wishes and shift continuity. It cannot cost coverage, which is settled first. |
| **Monthly hours target** | Balanced | How hard to hit each person's contracted hours. |
| **Weekly hours band** | off | A soft floor and ceiling on hours per week, on top of the monthly target. Useful when the monthly target alone lets someone do 70 hours one week and 10 the next. |
| **Minimum / Maximum per week** | Off | The floor and ceiling of the band, in hours. Only shown while the band is on. |
| **Band strength** | Balanced | How hard the planner tries to stay inside the band. |

### Preferences, Skill Matching & Fatigue

| Setting | Default | What it does |
|---|---|---|
| **Shift wishes** | Balanced | The reward for granting a shift an employee asked for. *Off* ignores wishes entirely. |
| **Preferred days off** | Balanced | The cost of overriding a soft "rather not work" day. It never blocks an assignment; for that, leave the absence hard. |
| **Skill downgrade cost** | Balanced | The cost of covering a post with a more senior person from the same skill group. Only matters if you have set up skill groups. |
| **Fatigue balancing** | Balanced | How hard the plan works to protect the most fatigued person. *Off* switches fatigue tracking off. |
| **Night shift fatigue** | Twice as hard | How draining a night shift is compared with a day shift of the same length: *Same as a day shift*, *Slightly harder*, *Twice as hard* or *Three times as hard*. |

### Coverage & Continuity

| Setting | Default | What it does |
|---|---|---|
| **Keep rotations** | on | Fixed shifts and days off from [rotation patterns](creating-a-plan.md#fixed-rhythms-rotations) are planned first, ahead of staffing and every other goal. Off: the planner ignores them. The patterns stay saved and apply again when you switch it back on. |
| **Minimum staffing** | Target | *Target (may fall short)*: the planner staffs up to each minimum whenever it can and accepts a short slot when it cannot, so you always get a plan. *Requirement (must be met)*: no slot may fall below its minimum. Use it only where a station legally cannot run short, and expect *infeasible* for a period that cannot be staffed. |
| **Workstation priority** | Balanced | How sharply high-priority workstations are staffed before the rest when there are not enough people: *Treat all the same*, *Slight preference*, *Balanced* or *Strict order*. |
| **Shift continuity** | Balanced | Reward for keeping someone on the same shift on consecutive days. Raise it if people are rotated too often. |
| **Week-streak bonus** | Balanced | Extra reward for seven or more days in a row on the same shift. |

### Solver Performance

**Search effort** decides how long and how wide the solver searches before it
hands back its best roster. The line under it spells out what the choice
means.

| Level | Time limit | CPU threads |
|---|---|---|
| **Quick** | 30 s | 4 |
| **Balanced** (default) | 120 s | 8 |
| **Thorough** | 300 s | 16 |

*Custom* appears when the values were set to something else in expert view.

**Search effort is the honest quality knob.** The planner returns the best
roster it found within the budget, so a status of *feasible* on a large ward
usually just means the timer expired. If a roster looks unpolished, choosing
**Thorough** and recalculating is the first thing to try. It costs nothing but
a few minutes of waiting.

Press **Save Changes**. The timestamp beside the button shows when the settings
were last altered, and the [audit log](administration.md#the-audit-log) shows
by whom and what changed.

---

## Reading the outcome

| Symptom | Likely cause |
|---|---|
| A workstation is consistently thin | Not enough qualified people available, or its priority is too low relative to others |
| One person is doing all the nights | Very few people have the night shift ticked as available |
| People are rotated between shifts daily | **Shift continuity** too low relative to **Fairness**, or try the *Stable rosters* preset |
| Somebody is well under their contracted hours | Their capabilities or available shifts don't match what you're staffing |
| Everyone is under their hours | The ward is over-staffed for the workload you described — or **Match monthly hours** was left off |

For problems rather than preferences, see [When something looks
wrong](troubleshooting.md).

---

!!! info "For the technically minded"
    Under the bonnet this is a constraint-programming model solved with Google
    OR-Tools' CP-SAT solver. The exact constraint formulation, the objective
    terms and their provenance in the nurse-scheduling literature are
    documented in [Optimizer](../planner.md).
