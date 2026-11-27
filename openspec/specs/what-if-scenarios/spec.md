# what-if-scenarios Specification

## Purpose
Planners try "what happens if…" — a sick wave, a closed ward, new hires — without touching real data, and see staffing gaps months ahead.

## Requirements

### Requirement: Scenarios never touch real data
A scenario SHALL be the real planning input with overrides — extra absences, closed workstations, hypothetical hires, a different minimum staffing — solved on its own. Its result SHALL never be the latest proposal, SHALL be listed apart from real proposals, and SHALL NOT be taken as the roster.

#### Scenario: Take as Plan
- **WHEN** someone tries to take a scenario's result as the roster
- **THEN** it is refused; promoting a scenario means planning with the real data

### Requirement: Compare
A scenario's result SHALL be comparable with a real proposal on the scheduler's Compare tab.

### Requirement: Capacity forecast
For the coming months the system SHALL show contracted hours minus recorded absences against the hours the workstations need (their minimum per shift or demand curve), in total and per capability, highlighting months with a gap. It SHALL be for planners and admins.
