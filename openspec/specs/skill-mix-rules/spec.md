# skill-mix-rules Specification

## Purpose
The ward says who has to — or may not — work alongside whom. The solver keeps the rules, the plan check reports breaches, and repairs and replacements do not create hard breaches.

## Requirements

### Requirement: Skill mix
A planner or admin SHALL be able to require that a staffed slot has at least N people with a capability (or a higher level of its skill group) or with a skill group from a level, and to cap the holders of a capability at N. A slot SHALL be a day and shift, at one workstation or summed over all. An empty slot SHALL break no minimum.

#### Scenario: A senior per shift
- **WHEN** a hard rule asks for at least one level-3 nurse per shift
- **THEN** every staffed shift of the plan has one

#### Scenario: Cannot hold
- **WHEN** a hard minimum cannot be met on a day
- **THEN** that slot stays empty and is reported as short, rather than staffed against the rule

#### Scenario: Soft
- **WHEN** a soft minimum cannot be met on a day
- **THEN** the slot is staffed and the breach is named in the result

### Requirement: Pairing
A planner or admin SHALL be able to say that a trainee works only where their mentor works (same shift and workstation), that two people work the same shift whenever both work, or that two people never share a shift. The same rule twice, or two people both kept apart and paired, SHALL be refused.

#### Scenario: Mentor away
- **WHEN** the mentor is unavailable on a day and the rule is hard
- **THEN** the trainee does not work that day

### Requirement: One meaning everywhere
The meaning of every rule SHALL live in one module shared byte-for-byte by the solver and the agent. The plan check SHALL report hard breaches as errors and soft ones as warnings. Repair, short-notice replacement and the swap check SHALL refuse a placement that breaks a hard pairing or at-most rule.

### Requirement: Who sees them
Only planners and admins SHALL read or change the rules.
