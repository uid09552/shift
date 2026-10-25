*** Settings ***
Documentation       Recording an absence on the employee calendar itself: absence mode,
...                 two clicks for the days, a toggle box for the type, and the entry in
...                 the list below. A planner may; a viewer is not offered it.
...
...                 The planner test makes its own employee and deletes it afterwards
...                 (its roster entries go with it), through the API from the signed-in
...                 browser. The days are in a month six ahead, so they are in a draft
...                 month: no reason prompt, and nothing a published roster could be
...                 disturbed by.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/employee_calendar_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application

Force Tags          schedule    absences


*** Test Cases ***
A Planner Records Sick Leave By Picking Days On The Calendar
    Log In As    admin
    Create Absence Employee
    Open Employee Calendar    ${EMPLOYEE_ID}
    Go Forward Months    6
    Start Adding An Absence
    Pick Days    ${TARGET_MONTH}-10    ${TARGET_MONTH}-11
    Choose Absence Type    sick
    Add The Absence
    Absence Should Be Listed    ${TARGET_MONTH}-10    sick
    [Teardown]    Remove Absence Employee And Log Out

A Viewer Is Not Offered To Record An Absence
    [Documentation]    With an employee chosen, which is when a planner would see
    ...                the button. The first employee on the list will do.
    Log In As    viewer
    Open Page    ${APP_PATH}employee-calendar
    Wait For Elements State    css=#employee-select option >> nth=1    attached    ${TIMEOUT}
    Select Options By    css=#employee-select    index    1
    Add Absence Should Not Be Offered
    [Teardown]    Run Keyword And Ignore Error    Log Out


*** Keywords ***
Create Absence Employee
    ${suffix}=    Evaluate    __import__('uuid').uuid4().hex[:8]
    ${response}=    Http    /api/v1/employees    POST
    ...    {"name": "E2E Absence ${suffix}", "email": "e2e-absence-${suffix}@test.invalid"}
    ...    {"Content-Type": "application/json"}
    Should Be True    200 <= ${response}[status] < 300    ${response}
    Set Test Variable    ${EMPLOYEE_ID}    ${response}[body][id]
    ${month}=    Evaluate
    ...    (lambda t, n: f"{t.year + (t.month - 1 + n) // 12}-{(t.month - 1 + n) % 12 + 1:02d}")(__import__('datetime').date.today(), 6)
    Set Test Variable    ${TARGET_MONTH}    ${month}

Remove Absence Employee And Log Out
    [Documentation]    Takes the employee, and with it every entry the test made; then
    ...                ends the session.
    Run Keyword And Ignore Error    Http    /api/v1/employees/${EMPLOYEE_ID}    DELETE
    Run Keyword And Ignore Error    Log Out
