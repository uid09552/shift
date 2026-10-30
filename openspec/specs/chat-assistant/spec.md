# chat-assistant Specification

## Purpose
Defines how the in-app chat assistant behaves on roster changes, the caller's role and the scheduling features: what it asks before writing, what it tells the user a write will cause, and which sources it answers from.

## Requirements

### Requirement: Reason before a guarded roster write
Before a roster write that the month status requires a reason for, the assistant SHALL ask the user for the reason. That is a change to a published day inside the freeze window, or an admin's change to a locked month. The assistant SHALL send the user's reason URL-encoded as `X-Change-Reason`, and SHALL NOT invent a reason.

#### Scenario: Freeze window
- **WHEN** a planner asks to move someone on a published day three days from now
- **THEN** the assistant asks why before calling the write and sends the given reason with it

#### Scenario: Reason required answer
- **WHEN** a write comes back 428 `reason_required`
- **THEN** the assistant asks the user for a reason and retries only with the reason the user gave

#### Scenario: Non-ASCII reason
- **WHEN** the reason is "Krankmeldung Müller"
- **THEN** the header value is sent URL-encoded and the write succeeds

### Requirement: Say what a published write causes
Before a write to a published or locked month, the assistant SHALL say that each changed employee-day becomes a change notice for the people affected. It SHALL wait for the user's confirmation. A write to a draft month SHALL need no such warning.

#### Scenario: Published month
- **WHEN** a planner asks to change a confirmed shift in a published month
- **THEN** the assistant says the affected employees will be notified and asks for a yes first

### Requirement: Month status answers
The assistant SHALL answer questions about month status from the backend's roster-month data: draft, published or locked, the publish deadline, and why an edit is refused. Publish, unpublish, unlock and lock SHALL be confirmed with the user first. An unpublish or unlock SHALL carry the user's reason.

#### Scenario: Why can't I edit
- **WHEN** a planner asks why a change to the 3rd was refused
- **THEN** the assistant reports the month's status and the freeze window or lock that applies

#### Scenario: Publish
- **WHEN** a planner asks to publish next month
- **THEN** the assistant confirms the month, and only then publishes it

### Requirement: Short-notice replacement in the chat
For "X is absent, who can cover" questions, the assistant SHALL use the replacement search and report the ranked candidates and why the others are excluded. It SHALL write the assignment only after the user picks a colleague and confirms.

#### Scenario: Sick tomorrow
- **WHEN** a planner says "Anna is sick tomorrow, who can take her shift?"
- **THEN** the assistant resolves tomorrow's date, runs the replacement search for Anna's confirmed shift and lists the candidates best first

### Requirement: Swaps in the chat
The assistant SHALL let a viewer offer, accept, decline and cancel their own swap requests. It SHALL let a planner approve or reject them, and run the swap check first to report its warnings. Swap-check violations are reported as warnings, never as a refusal.

#### Scenario: Planner reviews a swap
- **WHEN** a planner asks to approve a pending swap
- **THEN** the assistant reports the swap check's violations, if any, and approves only after the planner confirms

### Requirement: Rotation preview before apply
When asked to apply a rotation pattern, the assistant SHALL first run the apply as `dry_run` and show what would be written. It SHALL apply for real only after the user confirms.

#### Scenario: Apply rotation
- **WHEN** a planner asks to put three people on the night rotation from Monday
- **THEN** the assistant shows the previewed assignments and applies them only after a yes

### Requirement: Role-aware answers
The assistant SHALL learn the caller's roles and own employee from the backend before answering personal or permission-dependent questions. A `shift-viewer` SHALL get their own shifts, wishes, swaps and change notices. The assistant SHALL NOT offer viewers a write their role cannot make.

#### Scenario: My shifts
- **WHEN** a viewer asks "when do I work next week?"
- **THEN** the assistant answers from that viewer's own confirmed shifts without asking who they are

#### Scenario: Viewer asks for a planner action
- **WHEN** a viewer asks the assistant to publish a month
- **THEN** the assistant says this needs a planner and does not call the write

#### Scenario: Caller not linked to an employee
- **WHEN** the caller's identity matches no employee
- **THEN** the assistant says it cannot find their employee record instead of guessing one

### Requirement: Feature explanations from documentation
The documentation bundle SHALL cover these topics, so that "how does X work" questions about them are answered from it:
- the roster lifecycle and freeze window;
- change notices;
- shift swaps;
- short-notice replacement;
- rotation patterns;
- personal limits;
- the labor-law profile;
- automatic planning.

#### Scenario: Auto-plan question
- **WHEN** a planner asks why the automatic plan stayed a proposal
- **THEN** the assistant reports the stored last outcome and note of the automatic planning, and explains it with the documentation's conditions for taking an automatic plan

#### Scenario: Labor law question
- **WHEN** a user asks what the ArbZG profile enforces
- **THEN** the answer names the modelled rules from the documentation and says it is a modelled subset, not legal advice
