*** Settings ***
Documentation       The use case picked on the planner settings page is remembered: it
...                 is saved with the values, shown as selected after a reload, and
...                 still named when a value has since been changed.
...
...                 The suite puts the settings back as it found them, through the API,
...                 whether it passed or not.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/planner_settings_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application

Force Tags          settings    use-case


*** Test Cases ***
The Picked Use Case Is Remembered And Survives A Fine-Tuned Value
    Log In As    admin
    Remember The Settings
    Open Planner Settings
    Pick Use Case    wellbeing
    Save Planner Settings
    Open Planner Settings
    Use Case Should Be Selected    wellbeing
    Use Case Status Should Contain    Use case:

    Change One Value Through The API
    Open Planner Settings
    Use Case Should Be Selected    wellbeing
    Use Case Status Should Contain    changed
    [Teardown]    Put The Settings Back


*** Keywords ***
Remember The Settings
    ${response}=    Http    /api/v1/planner-settings    GET
    Should Be True    200 <= ${response}[status] < 300    ${response}
    Set Test Variable    ${ORIGINAL}    ${response}[body]

Change One Value Through The API
    [Documentation]    A weight the use case sets, moved by one: the label stays, the
    ...                values no longer equal the use case's.
    ${response}=    Http    /api/v1/planner-settings    GET
    ${current}=    Set Variable    ${response}[body]
    ${changed}=    Evaluate    json.dumps({**$current, "fatigue_weight": $current["fatigue_weight"] + 1})    modules=json
    ${put}=    Http    /api/v1/planner-settings    PUT    ${changed}    {"Content-Type": "application/json"}
    Should Be True    200 <= ${put}[status] < 300    ${put}

Put The Settings Back
    ${json}=    Evaluate    json.dumps($ORIGINAL)    modules=json
    Run Keyword And Ignore Error    Http    /api/v1/planner-settings    PUT    ${json}    {"Content-Type": "application/json"}
    Run Keyword And Ignore Error    Log Out
