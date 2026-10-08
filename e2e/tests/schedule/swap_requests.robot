*** Settings ***
Documentation       A shift swap from request to roster: Anna (the `viewer` account)
...                 offers her shift today for a colleague's, the colleague accepts,
...                 and an admin — notified by the bell — reviews and approves it.
...
...                 The colleague's account, both employees' shifts and Anna's
...                 employee record (if missing) are set up through the API and
...                 removed afterwards, see resources/swap_data.resource. The rule
...                 warnings depend on the agent being up; the test only needs the
...                 review to open, with warnings or the reason there are none.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/swap_data.resource
Resource            ../../resources/pages/schedule_page.resource

Suite Setup         Prepare
Suite Teardown      Clean Up
Test Teardown       Log Out

Force Tags          schedule    swaps    rbac


*** Test Cases ***
Request, Accept And Approve A Swap
    Log In As    viewer
    Open Schedule Page
    Request Swap    ${ANNA}[id]    ${COLLEAGUE}[id]    ${TODAY}
    ${swap_id}=    Latest Swap Request Id
    Log Out

    Log In With    ${COLLEAGUE_USERNAME}    ${COLLEAGUE_PASSWORD}
    Open Schedule Page
    Open Swap Requests
    Accept Swap Request    ${swap_id}
    Log Out

    Log In As    admin
    Open Schedule Page
    Bell Should Count Swaps Awaiting A Planner
    Open Swap Requests
    Review And Approve Swap Request    ${swap_id}


*** Keywords ***
Prepare
    Open Application
    Log In As    admin
    Set Up Swap Data
    Log Out

Clean Up
    Log In As    admin
    Tear Down Swap Data
    Log Out
    Close Application
