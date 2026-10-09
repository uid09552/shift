*** Settings ***
Documentation       The month status on the Schedule page: an admin publishes a month
...                 and takes it back to draft, giving the reason the backend asks for
...                 (HTTP 428 → reason dialog → retry).
...
...                 Uses a month about four months ahead, which a live environment
...                 has normally not published yet, and leaves it as draft again.

Library             DateTime
Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/roster_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Teardown       Log Out

Force Tags          schedule    roster    rbac


*** Test Cases ***
Publish A Month And Take It Back To Draft
    [Tags]    smoke
    ${month}=    Untouched Month
    Log In As    admin
    Open Schedule Month    ${month}
    Month Should Be    ${month}    draft
    Publish Month    ${month}
    Take Month Back To Draft    ${month}    e2e: published by the roster_month suite


*** Keywords ***
Untouched Month
    [Documentation]    YYYY-MM about four months from today.
    ${later}=    Get Current Date    increment=120 days    result_format=%Y-%m
    RETURN    ${later}
