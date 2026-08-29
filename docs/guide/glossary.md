# Glossary

Every term this application uses, in plain language. Sorted alphabetically.

**Absence**
: A day somebody cannot work. Recorded as *Unavailable*, *Vacation* or *Sick
  Leave*. See [Managing your staff](people.md#leave-and-unavailability).

**Active shifts**
: The shifts that actually run at a particular workstation. A day clinic with
  no night service has the night shift unticked.

**Assistant**
: The chat window in the bottom-right corner. Ask it for things in ordinary
  sentences. See [The built-in assistant](assistant.md).

**Available shifts**
: Which shift types a person works *at all* — a contractual fact, not a weekly
  preference. Somebody on days only has the night shift unticked.

**Capability**
: A qualification, skill or licence: *Intensive care*, *Anaesthesia*, *Wound
  care*. Workstations require them; people hold them. This is what decides who
  may work where.

**Confirmed plan**
: The official roster. What you see in the Schedule and calendar views. A
  calculated plan becomes a confirmed plan only when someone presses **Take as
  Plan**.

**Feasible**
: A calculation result meaning "this roster obeys every rule, and it was the
  best I found before my time ran out". A perfectly usable roster — see
  [Creating a schedule](creating-a-plan.md#the-result-line).

**Free days after**
: Compulsory days off following a particular shift. Set to `2` on a night
  shift for the usual recovery rule.

**Hard absence**
: An absence the planner will never override. The default. As opposed to a
  *soft preference*.

**Infeasible**
: A calculation result meaning "your rules contradict each other; no valid
  roster exists". Nothing is produced. See [When something looks
  wrong](troubleshooting.md#the-status-says-infeasible).

**Job**
: One calculation run. The **Jobs** button on the Schedule Optimizer lists
  them with their status.

**Max staffing**
: The ceiling on how many people may be on a shift or at a workstation. Never
  exceeded.

**Min staffing**
: How many people you *want*. A target the planner works towards, not a limit
  it must respect — so a shortfall shows up as a thin day rather than a
  failure.

**Monthly working hours**
: A person's contracted hours per month. A target the planner aims at;
  overshooting and undershooting are penalised equally.

**Optimal**
: A calculation result meaning the planner proved no better roster exists
  under your rules.

**Optimizer**
: The part of the system that calculates rosters. Also called *the planner* in
  this guide. See [How the automatic planner
  decides](how-planning-works.md).

**Organisation**
: The ward or hospital whose data you are working on. Chosen at login. Data is
  completely separated between organisations.

**Planner Settings**
: The page holding the rules and priorities that govern every calculation.
  **Configuration → Planner Settings**.

**Priority**
: `High`, `Medium` or `Low` on a workstation. Decides which posts get staffed
  first when there are not enough people to go round.

**Proposal**
: A calculated but not yet confirmed roster. Harmless — it changes nothing
  until you press **Take as Plan**.

**Score**
: The planner's internal quality number for a proposal. Only meaningful when
  comparing two runs over the same period with the same settings. Higher is
  better.

**Shift**
: A named work period — *Early*, *Late*, *Night*, *On call* — with times set
  per weekday.

**Shift wish**
: A person's request for a particular shift on a particular day. The planner
  is rewarded for granting it, but may decide otherwise. Set from the Employee
  Calendar.

**Wish window**
: Whether staff may enter their own shift wishes, and for which days — open,
  closed, or a date range. **Configuration → Wish Window**, admins only.
  Planners and admins are never limited by it.

**Short name**
: The one- or two-letter abbreviation for a shift, shown in calendar squares.

**Skill group / skill level**
: Optional fields on a capability that mark it as one rank of a ranked family
  (junior / senior / lead). Lets the planner substitute upwards while avoiding
  wasting senior staff on junior work. Leave blank if your qualifications
  aren't tiered.

**Soft preference**
: An absence marked *"the optimizer may still schedule this if needed"*. A
  wish to be off rather than an inability to work — the planner avoids it, but
  will override it rather than leave a post empty.

**Take as Plan**
: The button that turns a calculated proposal into the confirmed roster. It
  overwrites whatever was confirmed for that period.

**Tenant**
: The technical word for an *organisation*. You may see it in administrative
  screens.

**Workstation**
: A place that has to be staffed — a ward, a theatre, a unit, a desk. It
  requires capabilities, runs certain shifts, and needs a certain number of
  people.
