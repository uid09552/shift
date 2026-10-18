## ADDED Requirements

### Requirement: Protected-group data
An employee's personal limits MAY carry a `date_of_birth` and a `maternity_protection` flag, used only by the labor-law profile. Both SHALL be returned and changed only for `shift-admin` and `shift-planner`, and an audit entry SHALL record that they changed, not their values.

#### Scenario: Set date of birth
- **WHEN** a planner stores a date of birth in an employee's personal limits
- **THEN** it is returned with the limits and sent to the optimizer

#### Scenario: Hidden from viewers
- **WHEN** a `shift-viewer` reads personal limits
- **THEN** no record includes `maternity_protection` or `date_of_birth`
