# audit-log Specification

## Purpose
Record who changed what.

## Requirements

### Requirement: Entries
Changes SHALL be recorded with actor, action, entity type, entity id and a `changes` payload. Creates and updates hold the new state; deletes hold the deleted item's name.

#### Scenario: Update logged
- **WHEN** an entity is updated
- **THEN** an entry holds the new state

### Requirement: Read-only query
`GET /audit-logs` SHALL filter by actor (partial, case-insensitive), action, entity type and id, and date range; `GET /audit-logs/facets` SHALL list the actions, types and actors on record.

#### Scenario: Item history
- **WHEN** filtered by entity type and id
- **THEN** only that item's entries are returned

### Requirement: No writes
The API SHALL NOT allow creating, editing or deleting entries.

#### Scenario: Write attempt
- **WHEN** a client tries to modify an entry
- **THEN** the API offers no such operation
