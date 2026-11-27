# duty-types Specification

## Purpose
On-site standby and on call from home are hospital duties of their own; treated as regular shifts they get hours, rest and the law wrong.

## Requirements

### Requirement: Duty types
A shift SHALL have a duty type: regular, standby (on-site standby, Bereitschaftsdienst) or on call (from home, Rufbereitschaft).

### Requirement: Standby is working time
Standby SHALL count as working time in every hour limit and need its rest. Under the arbzg_de profile a standby duty MAY last up to 24 hours a day (ArbZG §7); a protected group keeps its own day limit.

### Requirement: On call is rest time
On call SHALL count no working hours while planning, need no rest before or after it and owe no night recovery. The optimizer, the plan check and the repair SHALL agree on this (legal.py, planner and agent copy).

#### Scenario: Early after a night on call
- **WHEN** someone was on call from home overnight
- **THEN** they may work the early shift the next morning

### Requirement: Call-ins
A planner SHALL be able to record the minutes someone was called in on an on-call duty afterwards. Those minutes SHALL count as working time for the labor-law hour windows of later plans. A call-in SHALL be refused on a day that is not an on-call duty.

### Requirement: Limits and visibility
An employee's personal limits SHALL include a maximum of on-call duties per calendar month. The Schedule page SHALL mark on-call and standby duties; the Fairness page SHALL count on-call duties apart from shifts and nights.
