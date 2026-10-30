*** Settings ***
Documentation       Reports › Analytics shows the ward over time: coverage, hours,
...                 absences, roster changes, audit activity and planning runs, all
...                 narrowed by one filter bar and by clicks in the charts. It is for
...                 planners and admins; a viewer is neither offered it nor shown it.
...
...                 Each test signs in as a different account, so the suite opens a
...                 fresh browser context per test rather than sharing a session.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/analytics_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Teardown       Log Out

Force Tags          reports    analytics


*** Test Cases ***
Admin Opens Analytics From The Sidebar
    [Tags]    smoke
    Log In As    admin
    Analytics Entry Should Be Offered
    Click    ${NAV_ANALYTICS}
    Wait For Condition    Url    contains    /analytics    timeout=${TIMEOUT}
    Element Should Be Visible    ${ANALYTICS_PAGE}

A Filter And A Heatmap Click Narrow The View Until The Chip Is Removed
    [Documentation]    A workstation filter and a day picked in the heatmap each add a
    ...                chip; the table narrows to the day, and removing that chip
    ...                brings the rows back.
    Log In As    admin
    Open Analytics
    Choose Period Preset    last12Months
    Filter By First Option    workstation
    Chip Count Should Be    1
    ${before}=    Table Count Text
    Click Heatmap Day
    Chip Count Should Be    2
    Wait Until Keyword Succeeds    ${TIMEOUT}    200ms    Table Count Should Differ    ${before}
    Remove Last Chip
    Chip Count Should Be    1
    Wait Until Keyword Succeeds    ${TIMEOUT}    200ms    Table Count Should Equal    ${before}

The View Is In The Address
    [Documentation]    Reloading keeps the period, filters and tab.
    Log In As    admin
    Open Analytics
    Choose Period Preset    lastMonth
    Filter By First Option    shift
    Open Analytics Tab    hours
    Reload
    Get Attribute    [data-testid="analytics-filter-preset-lastMonth"]    aria-pressed    ==    true
    Chip Count Should Be    1
    Element Should Be Visible    [data-testid="analytics-panel-hours"]

An Audit Group Opens The Filtered Audit Log
    Log In As    admin
    Open Analytics
    Choose Period Preset    last12Months
    Open Analytics Tab    audit
    Wait For Elements State    ${AUDIT_LINK} >> nth=0    visible    ${TIMEOUT}
    Click    ${AUDIT_LINK} >> nth=0
    Wait For Condition    Url    contains    /audit-log    timeout=${TIMEOUT}
    Wait For Condition    Url    contains    action=    timeout=${TIMEOUT}

Viewer Is Not Offered Analytics
    Log In As    viewer
    Analytics Entry Should Be Hidden

Viewer Opening Analytics Directly Lands On The Overview
    Log In As    viewer
    Open Page    ${APP_PATH}analytics
    Wait For Condition    Url    not contains    /analytics    timeout=${TIMEOUT}
    Element Should Not Exist    ${ANALYTICS_PAGE}


*** Keywords ***
Table Count Should Differ
    [Arguments]    ${before}
    ${now}=    Table Count Text
    Should Not Be Equal    ${now}    ${before}

Table Count Should Equal
    [Arguments]    ${before}
    ${now}=    Table Count Text
    Should Be Equal    ${now}    ${before}
