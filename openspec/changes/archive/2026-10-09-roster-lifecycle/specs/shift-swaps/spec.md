# Spec Delta

## ADDED Requirements

### Requirement: Published roster only
A swap SHALL be requested only for shifts in `published` months. Approving a swap SHALL follow roster publication's editing rules. In a locked month it requires a `shift-admin` and a reason. Inside the freeze window it requires a reason. An approved swap SHALL create change notices for both employees.

#### Scenario: Shift in a draft month
- **WHEN** a viewer requests a swap of a shift in a draft month
- **THEN** the request is refused

#### Scenario: Approval inside the freeze window
- **WHEN** a planner approves a swap of a shift two days ahead without a reason
- **THEN** approval is refused with a message asking for a reason, and the request stays `pending_planner`

#### Scenario: Approval in a locked month
- **WHEN** a planner approves a swap whose shift lies in a month that was locked meanwhile
- **THEN** approval is refused and the request stays `pending_planner`
