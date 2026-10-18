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
