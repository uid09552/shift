# Spec Delta

## Purpose

Defines what the MCP server offers beyond the operations generated from the OpenAPI spec: the plan check, repair, replacement search, swap check and browser navigation. Any MCP client gets the same answers as the app's own pages.

## ADDED Requirements

### Requirement: Plan check tool
The MCP server SHALL offer `validateOptimizedPlan(result_id)`. It returns the same report as `POST /agent/plan/validate` for the same stored result: hard violations, warnings, the legal section and a headline. It SHALL NOT write anything.

#### Scenario: Same answer as the scheduler page
- **WHEN** an MCP client checks a stored result that the scheduler page's *Verify Plan* also checked
- **THEN** both report the same findings with the same counts

#### Scenario: Unknown result
- **WHEN** the result id does not exist for the caller's tenant
- **THEN** the tool returns an error message and no report

### Requirement: Plan repair tool
The MCP server SHALL offer `repairOptimizedPlan(result_id, instruction, strategy)`, with `strategy` either `repair` or `resolve`. It applies the same repair as `POST /agent/plan/fix`, saves the repaired plan to the stored result, and returns the change log and the check after the repair.

#### Scenario: Local repair
- **WHEN** a client repairs a plan with a hard violation, strategy `repair` and no instruction
- **THEN** the stored result is updated and the returned check after the repair no longer contains that violation, or the reason why it could not be fixed

#### Scenario: Re-solve
- **WHEN** strategy is `resolve`
- **THEN** the period is solved again with the caller's pinned rows locked, and the call is allowed to run as long as a solve

### Requirement: Free-text repair instruction on the MCP server
`repairOptimizedPlan` SHALL read a free-text `instruction` with an LLM configured on the MCP server. When no LLM is configured or reachable, a non-empty instruction SHALL produce an error that says so, and no change is saved. An empty instruction SHALL never need the LLM.

#### Scenario: Instruction applied
- **WHEN** the instruction is "Anna is off sick Thursday" and an LLM is configured
- **THEN** Anna's Thursday row is moved or removed, or refused with a reason when no legal move exists

#### Scenario: No LLM
- **WHEN** an instruction is given and no LLM is reachable
- **THEN** the tool returns an error naming the missing LLM and the stored plan is unchanged

### Requirement: Replacement search tool
The MCP server SHALL offer `findReplacement(employee_id, date)`. It returns the same ranked candidates and exclusion reasons as `POST /agent/roster/replacements`, and writes nothing.

#### Scenario: Sick colleague
- **WHEN** a client asks who can take an employee's confirmed shift on a date
- **THEN** allowed colleagues come back ranked, and everyone else comes back with the rule that rules them out

#### Scenario: No shift that day
- **WHEN** the employee has no confirmed shift on that date
- **THEN** the tool returns an error saying so

### Requirement: Swap check tool
The MCP server SHALL offer `checkShiftSwap(requester, colleague)`, each side being `{employee_id, date}`. It returns the same per-employee violations as `POST /agent/roster/swap-check`. Violations are warnings only, and nothing is written.

#### Scenario: Swap breaking rest
- **WHEN** the swap would leave the requester with less than the minimum rest
- **THEN** the requester's entry lists that violation and the colleague's entry lists their own, possibly none

### Requirement: Tools run as the caller
Every tool in this capability SHALL read and write the backend with the access token the MCP caller presented, so it sees only that caller's tenant and is bound by that caller's role. The static fallback token SHALL apply only when the caller presented none.

#### Scenario: Viewer repairs a plan
- **WHEN** a `shift-viewer` calls `repairOptimizedPlan`
- **THEN** the save is refused by the backend and the tool reports the refusal, with nothing written

#### Scenario: Tenant isolation
- **WHEN** a caller of tenant A passes a result id belonging to tenant B
- **THEN** the tool reports that the result was not found

### Requirement: Navigable pages
`navigate` SHALL accept every page of the app's main navigation. That includes `changes` (roster change notices), `relationships` (who can work where) and `users` (organization users), in addition to the pages it accepts today. An unknown page SHALL return the list of valid names.

#### Scenario: Change notices page
- **WHEN** `navigate("changes")` is called
- **THEN** the result is a navigate action to `/changes`
