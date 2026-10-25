*** Settings ***
Documentation       The automatic-planning schedule on the planner settings page is kept:
...                 switched on with an interval, a weekday and a range, saved, and found
...                 again after a reload; switching it off is kept too.
...
...                 The suite puts the settings back as it found them, through the API,
...                 whether it passed or not.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/planner_settings_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application

Force Tags          settings    auto-plan


*** Test Cases ***
The Schedule Is Kept After A Reload And Can Be Switched Off Again
    Log In As    admin
    Remember The Settings
    Open Planner Settings
    Automatic Planning Should Be    false
    Switch Automatic Planning
    Set Automatic Planning Schedule    2    3    months:2
    Save Planner Settings

    Open Planner Settings
    Automatic Planning Should Be    true
    Automatic Planning Schedule Should Be    2    3    months:2
    Get Text    [data-testid="auto-plan-next-run"]    contains    Next run

    Switch Automatic Planning
    Save Planner Settings
    Open Planner Settings
    Automatic Planning Should Be    false
    Automatic Planning Schedule Should Be    2    3    months:2
    [Teardown]    Put The Settings Back


*** Keywords ***
Remember The Settings
    ${response}=    Http    /api/v1/planner-settings    GET
    Should Be True    200 <= ${response}[status] < 300    ${response}
    Set Test Variable    ${ORIGINAL}    ${response}[body]

Put The Settings Back
    [Documentation]    The status fields belong to the server and are ignored on a PUT.
    ${json}=    Evaluate    json.dumps($ORIGINAL)    modules=json
    Run Keyword And Ignore Error    Http    /api/v1/planner-settings    PUT    ${json}    {"Content-Type": "application/json"}
    Run Keyword And Ignore Error    Log Out
