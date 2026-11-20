# email-notifications Specification

## Purpose
People are told by e-mail what concerns them. Nothing is sent inline: events queue mail and a worker delivers it, so a mail problem never fails the action behind it.

## Requirements

### Requirement: Off without a mail server
Without a configured SMTP host the system SHALL queue nothing and report that e-mail is not configured. A setting that cannot work SHALL stop the server from starting.

#### Scenario: No host
- **WHEN** an event happens and `smtp.host` is empty
- **THEN** no message is queued

### Requirement: Events
The system SHALL notify: everyone with a shift in a month when it is published; an employee whose published roster changed, in one message per sweep rather than per day; the people in a shift swap as it moves; an employee whose leave request is decided; and the employees who may take a newly offered open shift, and the one it is assigned to. Changes older than one day SHALL NOT be announced.

#### Scenario: Publication
- **WHEN** a month is published
- **THEN** each employee with a shift in it gets one message

#### Scenario: Changes batched
- **WHEN** several days of one employee's published roster changed
- **THEN** one message lists them, and the same changes are never announced twice

#### Scenario: History
- **WHEN** mail is switched on while older change notices exist
- **THEN** they are marked handled and not announced

### Requirement: Preferences
Each employee SHALL be able to switch the whole channel or single events off. Everything SHALL be on until they do. An employee without a matching account record has nothing to set.

#### Scenario: Muted event
- **WHEN** an event happens for an employee who muted it
- **THEN** no message is queued for them

### Requirement: Reliable delivery
Queued messages SHALL be delivered by a worker. A failed attempt SHALL be retried with a growing delay and the message marked `failed` with the last error after five attempts. Two workers SHALL NOT send the same message. A mail problem SHALL NOT fail or slow the action that raised the event.

#### Scenario: Retry
- **WHEN** sending fails
- **THEN** the message stays `pending` and is tried again after the delay

#### Scenario: Giving up
- **WHEN** the fifth attempt fails
- **THEN** the message is `failed` and keeps the reason

### Requirement: Content
A message SHALL name the shift, the date and the status. It SHALL NOT contain the reason behind a legal rule or anything from an employee's protected-group data. Planners and admins MAY read the outbox; other roles MAY NOT.
