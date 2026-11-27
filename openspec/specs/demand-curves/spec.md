# demand-curves Specification

## Purpose
Real demand varies by hour; a minimum per shift overstaffs quiet hours or misses peaks.

## Requirements

### Requirement: A curve per workstation and weekday
A planner SHALL be able to set, per workstation and weekday, how many people are needed in each hour (0–99). Public holidays SHALL use Sunday's curve. Without a curve the per-shift minimum SHALL apply as before.

### Requirement: Covering the curve
On a weekday with a curve the optimizer SHALL cover every hour (a shift covers an hour when it is on duty at its middle; an overnight shift covers the next morning), soft or hard as minimum staffing is, and SHALL keep surplus person-hours low — choosing which shift types to use. Hours it cannot cover SHALL be named in the result's message.

#### Scenario: Peak
- **WHEN** the curve asks for one person 06–22 and two between 10 and 14
- **THEN** the plan has an early, a late and a mid shift, not three earlies

### Requirement: Shown in the Day view
The Day view SHALL show, per workstation with a curve that day, the headcount needed against the staff planned, hour by hour.
