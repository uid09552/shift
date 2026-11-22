# calendar-feed Specification

## Purpose
An employee subscribes to their published shifts in the calendar on their phone. Calendar apps cannot sign in, so a secret link is the key.

## Requirements

### Requirement: The link
An employee SHALL be able to make a calendar link for themselves. Only a hash of its token SHALL be stored, so the link SHALL be shown only in the answer that made it. Making a new link SHALL stop the old one; removing it SHALL stop it too. An account without an employee record SHALL be refused.

#### Scenario: Make a link
- **WHEN** an employee makes a calendar link
- **THEN** the answer carries the link, and later reads only say that one exists

#### Scenario: Replace
- **WHEN** an employee makes a second link
- **THEN** the first one no longer serves a calendar

### Requirement: The feed
The feed SHALL be served without sign-in to whoever holds the token, as RFC 5545. It SHALL hold the employee's confirmed shifts in published and locked months only — never a draft month, never an absence, never someone else's shift. An unknown or malformed token SHALL be a 404.

#### Scenario: Published only
- **WHEN** the employee has shifts in a published and in a draft month
- **THEN** the feed holds the published shift only

#### Scenario: Times
- **WHEN** a shift has times for that weekday
- **THEN** the event runs at those times, a night into the next morning; otherwise it is a whole-day event
