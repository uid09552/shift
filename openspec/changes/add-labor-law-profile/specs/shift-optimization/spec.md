## MODIFIED Requirements

### Requirement: Rest and workload rules
The optimizer SHALL honour night-shift recovery days, minimum rest hours, maximum consecutive days, maximum working days per week, employee unavailability, skills and shift availability. When a labor-law profile other than `none` is selected it SHALL also apply that profile's rules as hard rules, where a tenant limit and a legal limit differ the stricter wins, and a slot the legal rules leave unfillable SHALL be reported short rather than filled illegally.

#### Scenario: After night shift
- **WHEN** an employee works a night
- **THEN** they receive the configured recovery days off

#### Scenario: Legal rule stricter than tenant setting
- **WHEN** profile is `arbzg_de` and `min_rest_hours` is 9
- **THEN** 11 hours of rest are enforced

#### Scenario: Legal rule leaves slot short
- **WHEN** only a legally barred employee could fill a slot
- **THEN** the slot is named in `message` and not filled
