# long-term-fairness Specification

## Purpose
The unpopular duties — nights, weekends, public holidays, on call — are shared fairly over months and years, not only within one planning period.

## Requirements

### Requirement: Balance across periods
When the planner setting `fairness_horizon_months` is above 0, the optimizer SHALL be given each employee's nights, weekend days, holiday shifts and on-call duties from the confirmed roster over that many months before the period, and SHALL balance each count per contract hour across employees including them. A horizon of 0 SHALL switch this off.

#### Scenario: Whoever did the nights lately
- **WHEN** two employees with equal contracts can each take the period's nights, and one already worked twelve more over the horizon
- **THEN** the other gets the nights

#### Scenario: Part time
- **WHEN** a half-time employee has half the nights of a full-time one
- **THEN** both count as even

### Requirement: Year-end holiday rotation
Whoever worked Christmas (24–26 December) or New Year (31 December – 1 January) last year SHALL get that holiday's days this year as preferred days off — a soft preference, never a block.

### Requirement: Fairness report over a long horizon
The Fairness page SHALL offer the last 6 and 12 months and SHALL show holiday shifts and on-call duties per employee.
