*** Settings ***
Documentation       Test data for the shift swap suite, set up and removed through
...                 the API from the signed-in browser (the gateway adds the token),
...                 so the suite brings what it needs into any environment.
...
...                 The colleague is a fresh account each run, created through the
...                 admin's user management. Removing it takes it out of the
...                 organization; the Keycloak account itself stays behind.

Resource            common.resource
Library             DateTime


*** Variables ***
${COLLEAGUE_PASSWORD}       Swap-e2e-1!


*** Keywords ***
Api
    [Documentation]    One API call as the signed-in user; fails on anything but 2xx.
    [Arguments]    ${method}    ${path}    ${body}=${None}
    IF    $body is None
        ${response}=    Http    /api/v1${path}    ${method}
    ELSE
        ${json}=    Evaluate    $body if isinstance($body, str) else json.dumps($body)    modules=json
        ${response}=    Http    /api/v1${path}    ${method}    ${json}    {"Content-Type": "application/json"}
    END
    Should Be True    200 <= ${response}[status] < 300    ${method} ${path}: ${response}[status] ${response}[body]
    RETURN    ${response}[body]

Set Up Swap Data
    [Documentation]    As admin: a colleague account with an employee record,
    ...                Anna's employee record (the `viewer` account), and a shift for
    ...                each of them today — different shifts, so the swap shows.
    ...                Sets suite variables the tests and the teardown read.
    ${today}=    Get Current Date    result_format=%Y-%m-%d
    ${suffix}=    Evaluate    __import__('uuid').uuid4().hex[:8]
    ${colleague_user}=    Set Variable    swap-e2e-${suffix}
    ${colleague_email}=    Set Variable    ${colleague_user}@test.invalid
    ${account}=    Api    POST    /users    {"username": "${colleague_user}", "email": "${colleague_email}", "first_name": "Swap", "last_name": "Colleague", "password": "${COLLEAGUE_PASSWORD}", "temporary_password": false, "roles": ["shift-viewer"]}
    ${colleague}=    Api    POST    /employees    {"name": "Swap Colleague ${suffix}", "email": "${colleague_email}", "monthly_working_hours": 160}
    ${anna}    ${anna_created}=    Anna Employee
    ${shifts}=    Api    GET    /shifts
    ${count}=    Get Length    ${shifts}
    Skip If    ${count} < 2    The swap suite needs at least two shifts.
    ${anna_previous}=    Anna Row Today    ${anna}[id]    ${today}
    IF    $anna_previous and not $anna_previous['is_present']
        Skip    Anna is absent today; the suite will not overwrite that.
    END
    ${anna_shift}=    Set Variable If    $anna_previous and $anna_previous['shift_id']    ${anna_previous}[shift_id]    ${shifts}[0][id]
    ${colleague_shift}=    Set Variable If    $anna_shift == $shifts[0]['id']    ${shifts}[1][id]    ${shifts}[0][id]
    IF    not $anna_previous or not $anna_previous['shift_id']
        Api    POST    /employees/${anna}[id]/confirmed-shift-plans    {"shift_id": "${anna_shift}", "date": "${today}", "is_present": true}
    END
    Api    POST    /employees/${colleague}[id]/confirmed-shift-plans    {"shift_id": "${colleague_shift}", "date": "${today}", "is_present": true}
    Set Suite Variable    ${TODAY}    ${today}
    Set Suite Variable    ${ANNA}    ${anna}
    Set Suite Variable    ${ANNA_CREATED}    ${anna_created}
    Set Suite Variable    ${ANNA_PREVIOUS}    ${anna_previous}
    Set Suite Variable    ${COLLEAGUE}    ${colleague}
    Set Suite Variable    ${COLLEAGUE_ACCOUNT}    ${account}
    Set Suite Variable    ${COLLEAGUE_USERNAME}    ${colleague_user}

Anna Employee
    [Documentation]    The employee record of the `viewer` account, created if missing.
    ${email}=    Set Variable    ${USERS}[viewer][email]
    ${response}=    Http    /api/v1/employees/email/${email}
    IF    ${response}[status] == 200 and 'id' in $response['body']
        RETURN    ${response}[body]    ${False}
    END
    ${created}=    Api    POST    /employees    {"name": "Anna Müller", "email": "${email}", "monthly_working_hours": 160}
    RETURN    ${created}    ${True}

Anna Row Today
    [Arguments]    ${anna_id}    ${today}
    ${rows}=    Api    GET    /employees/${anna_id}/confirmed-shift-plans?from_date=${today}&to_date=${today}
    ${count}=    Get Length    ${rows}
    IF    ${count} == 0
        RETURN    ${None}
    END
    RETURN    ${rows}[0]

Latest Swap Request Id
    [Documentation]    The newest request the signed-in user can see.
    ${swaps}=    Api    GET    /shift-swaps
    RETURN    ${swaps}[0][id]

Tear Down Swap Data
    [Documentation]    As admin: the colleague goes, and Anna's day is put back as it was.
    ${ok}=    Run Keyword And Return Status    Variable Should Exist    ${COLLEAGUE}
    IF    not ${ok}    RETURN
    Run Keyword And Ignore Error    Api    DELETE    /employees/${COLLEAGUE}[id]
    Run Keyword And Ignore Error    Api    DELETE    /users/${COLLEAGUE_ACCOUNT}[id]
    ${row}=    Anna Row Today    ${ANNA}[id]    ${TODAY}
    IF    $ANNA_PREVIOUS
        Run Keyword And Ignore Error    Api    PUT    /confirmed-shift-plans/${row}[id]    {"shift_id": ${{__import__('json').dumps($ANNA_PREVIOUS['shift_id'])}}, "workstation_id": ${{__import__('json').dumps($ANNA_PREVIOUS['workstation_id'])}}}
    ELSE IF    $row
        Run Keyword And Ignore Error    Api    DELETE    /confirmed-shift-plans/${row}[id]
    END
    IF    ${ANNA_CREATED}
        Run Keyword And Ignore Error    Api    DELETE    /employees/${ANNA}[id]
    END
