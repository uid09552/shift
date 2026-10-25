*** Settings ***
Documentation       Page object for the planner settings: the labor-law profile and
...                 its averaging window, and saving.

Resource            ../common.resource


*** Variables ***
${LABOR_LAW_PROFILE}        css=#laborLawProfile
${LABOR_LAW_WEEKS}          [data-testid="planner-settings-labor-law-weeks"]
${SETTINGS_SAVE}            [data-testid="planner-settings-save"]


*** Keywords ***
Open Planner Settings
    Open Page    ${APP_PATH}planner-settings
    Wait For Elements State    ${LABOR_LAW_PROFILE}    visible    ${TIMEOUT}

Choose Labor Law Profile
    [Documentation]    `none` or `arbzg_de`.
    [Arguments]    ${profile}
    Select Options By    ${LABOR_LAW_PROFILE}    value    ${profile}

Labor Law Profile Should Be
    [Arguments]    ${profile}
    Get Selected Options    ${LABOR_LAW_PROFILE}    value    ==    ${profile}

Save Planner Settings
    Click    ${SETTINGS_SAVE}
    Wait For Response    matcher=**/api/v1/planner-settings    timeout=${TIMEOUT}

Pick Use Case
    [Documentation]    One of the cards under "Use case": balanced, fairness, wishes,
    ...                coverage, stability or wellbeing. Fills the form; nothing is saved yet.
    [Arguments]    ${use_case}
    Click    [data-testid="use-case-${use_case}"]

Use Case Should Be Selected
    [Arguments]    ${use_case}
    Get Attribute    [data-testid="use-case-${use_case}"]    aria-pressed    ==    true

Use Case Status Should Contain
    [Documentation]    The sentence under the cards, e.g. "Use case: Staff wellbeing".
    [Arguments]    ${text}
    Get Text    [data-testid="use-case-status"]    contains    ${text}

Switch Automatic Planning
    [Documentation]    Flips the "Plan automatically" switch. Nothing is saved yet.
    Click    [data-testid="auto-plan-enabled"]

Automatic Planning Should Be
    [Arguments]    ${state}
    Get Attribute    [data-testid="auto-plan-enabled"]    aria-checked    ==    ${state}

Set Automatic Planning Schedule
    [Documentation]    Every `${weeks}` weeks on `${weekday}` (0 = Monday), planning the
    ...                next `${range}` (`weeks:4`, `months:2`, …).
    [Arguments]    ${weeks}    ${weekday}    ${range}
    Select Options By    [data-testid="auto-plan-every"]    label    every ${weeks} weeks
    Select Options By    [data-testid="auto-plan-weekday"]    index    ${weekday}
    Select Options By    [data-testid="auto-plan-range"]    value    ${range}

Automatic Planning Schedule Should Be
    [Arguments]    ${weeks}    ${weekday}    ${range}
    Get Selected Options    [data-testid="auto-plan-every"]    label    ==    every ${weeks} weeks
    Get Selected Options    [data-testid="auto-plan-weekday"]    index    ==    ${weekday}
    Get Selected Options    [data-testid="auto-plan-range"]    value    ==    ${range}
