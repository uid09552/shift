## ADDED Requirements

### Requirement: Full-width apply screen
The Rotations page SHALL give the Apply panel the full width of the page, with the pattern list above it, so the preview grid is not confined to a partial column.

#### Scenario: Wide screen
- **WHEN** the Rotations page is shown on a wide screen
- **THEN** the Apply panel spans the full content width and the preview grid uses all of it

#### Scenario: Many days
- **WHEN** a preview covers more days than fit the width
- **THEN** the grid scrolls horizontally within the panel while the employee names stay visible

#### Scenario: Narrow screen
- **WHEN** the page is shown on a narrow screen
- **THEN** the pattern list and Apply panel stack in one column
