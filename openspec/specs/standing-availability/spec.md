# standing-availability Specification

## Purpose
Standing preferences — "only early shifts", "never on Wednesdays", part-time on fixed days — held as rules instead of one wish or absence per day.

## Requirements

### Requirement: Rules per employee
A planner or admin SHALL be able to give an employee rules of four kinds — only / never these shifts, only / never these weekdays — each hard or soft, optionally between two dates. An employee SHALL be able to read their own rules and no one else's. A rule that rules out every day, names no shift or weekday, or ends before it starts SHALL be refused.

### Requirement: Planning honours them
Over a planning period the rules SHALL be expanded into the inputs the solver and the agent already know: a hard weekday rule into a whole-day absence, a hard shift rule into a blocked shift on that day, a soft rule into a preferred day or shift off.

#### Scenario: Never late
- **WHEN** an employee has a hard rule never to work the late shift
- **THEN** the solver never plans them on it, and the plan check reports `shift_blocked` if a plan does

#### Scenario: Soft
- **WHEN** the rule is soft
- **THEN** the employee may still be planned against it, at the cost of a preference

### Requirement: Open shifts and replacements
An employee a hard rule keeps out SHALL NOT be able to volunteer for, or be offered as a replacement for, that shift on that day.
