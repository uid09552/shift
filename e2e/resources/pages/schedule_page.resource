*** Settings ***
Documentation       Page object for the Schedule page (ui/src/app/pages/planner/kalender):
...                 the week grid, the shift swap request flow and the swap requests
...                 panel, and the header bell's count of swaps awaiting a planner.

Resource            ../common.resource


*** Variables ***
${SWAP_REQUESTS_BUTTON}         [data-testid="schedule-swap-requests"]
${SWAP_REQUESTS_DIALOG}         [data-testid="swap-requests-dialog"]
${MENU_REQUEST_SWAP}            [data-testid="cell-menu-request-swap"]
${SWAP_PICK_BANNER}             [data-testid="schedule-swap-banner"]
${SWAP_CONFIRM_DIALOG}          [data-testid="swap-confirm-dialog"]
${SWAP_CONFIRM}                 [data-testid="swap-confirm"]
${SCHEDULE_NOTICE}              [data-testid="schedule-notice"]
${SWAP_ACCEPT}                  [data-testid="swap-accept"]
${SWAP_OPEN_REVIEW}             [data-testid="swap-open-review"]
${SWAP_REVIEW}                  [data-testid="swap-review"]
${SWAP_APPROVE}                 [data-testid="swap-approve"]
${BELL_SWAP_BADGE}              [data-testid="notifications-swap-badge"]


*** Keywords ***
Open Schedule Page
    Open Page    ${APP_PATH}kalender

Cell
    [Documentation]    The week grid's cell of one employee on one day (YYYY-MM-DD).
    [Arguments]    ${employee_id}    ${date}
    RETURN    [data-testid="schedule-cell-${employee_id}-${date}"]

Request Swap
    [Documentation]    As an employee: offers their own shift on ${date} for the
    ...                colleague's on the same day, through the cell menu.
    [Arguments]    ${my_id}    ${colleague_id}    ${date}
    ${mine}=    Cell    ${my_id}    ${date}
    ${theirs}=    Cell    ${colleague_id}    ${date}
    Click    ${mine}    right
    Click    ${MENU_REQUEST_SWAP}
    Element Should Be Visible    ${SWAP_PICK_BANNER}
    Click    ${theirs}
    Element Should Be Visible    ${SWAP_CONFIRM_DIALOG}
    Click    ${SWAP_CONFIRM}
    Element Should Be Visible    ${SCHEDULE_NOTICE}

Open Swap Requests
    Click    ${SWAP_REQUESTS_BUTTON}
    Element Should Be Visible    ${SWAP_REQUESTS_DIALOG}

Request Row
    [Documentation]    The panel's entry for one request, while it waits on the viewer.
    [Arguments]    ${swap_id}
    RETURN    [data-testid="swap-actionable-${swap_id}"]

Accept Swap Request
    [Arguments]    ${swap_id}
    ${row}=    Request Row    ${swap_id}
    Click    ${row} >> ${SWAP_ACCEPT}
    Swap Request Should Have Status    ${swap_id}    pending_planner

Review And Approve Swap Request
    [Documentation]    Opens the planner's review (rule warnings or why there are
    ...                none) and approves — warnings never stop it.
    [Arguments]    ${swap_id}
    ${row}=    Request Row    ${swap_id}
    Click    ${row} >> ${SWAP_OPEN_REVIEW}
    Element Should Be Visible    ${row} >> ${SWAP_REVIEW}
    Wait For Elements State    ${row} >> ${SWAP_APPROVE}    enabled    ${TIMEOUT}
    Click    ${row} >> ${SWAP_APPROVE}
    Swap Request Should Have Status    ${swap_id}    approved

Swap Request Should Have Status
    [Documentation]    Once answered, a request moves to the panel's list below.
    [Arguments]    ${swap_id}    ${status}
    Element Should Be Visible    [data-testid="swap-row-${swap_id}"] >> [data-testid="swap-status-${status}"]

Bell Should Count Swaps Awaiting A Planner
    Element Should Be Visible    ${BELL_SWAP_BADGE}
