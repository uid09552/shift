*** Settings ***
Documentation       The labor-law profile is chosen in the planner settings, survives a
...                 reload, and shows its averaging window only while it is on.
...
...                 The suite leaves the profile off again, as it found a fresh tenant.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/planner_settings_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application

Force Tags          settings    labor-law    smoke


*** Test Cases ***
A Planner Selects ArbZG And It Is Kept
    [Documentation]    Choosing the profile reveals the averaging window; after
    ...                saving and reloading the page, the choice is still there.
    Log In As    admin
    Open Planner Settings
    Choose Labor Law Profile    arbzg_de
    Element Should Be Visible    ${LABOR_LAW_WEEKS}
    Save Planner Settings
    Open Planner Settings
    Labor Law Profile Should Be    arbzg_de
    [Teardown]    Switch The Profile Off Again


*** Keywords ***
Switch The Profile Off Again
    Open Planner Settings
    Choose Labor Law Profile    none
    Save Planner Settings
    Labor Law Profile Should Be    none
    Log Out
