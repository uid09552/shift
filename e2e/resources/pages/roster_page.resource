*** Settings ***
Documentation       Page object for the roster lifecycle on the Schedule page: the
...                 month status pill and its menu (publish, back to draft, unlock,
...                 lock), the confirm and reason dialogs those open.

Resource            ../common.resource


*** Variables ***
${MONTH_PUBLISH}            [data-testid="roster-month-publish"]
${MONTH_UNPUBLISH}          [data-testid="roster-month-unpublish"]
${CONFIRM_DIALOG_CONFIRM}   [data-testid="confirm-dialog-confirm"]
${REASON_DIALOG}            [data-testid="reason-dialog"]
${REASON_INPUT}             [data-testid="reason-dialog-input"]
${REASON_SUBMIT}            [data-testid="reason-dialog-submit"]


*** Keywords ***
Open Schedule Month
    [Documentation]    The Schedule page's month view of ${month} (YYYY-MM).
    [Arguments]    ${month}
    Open Page    ${APP_PATH}kalender?month=${month}

Month Status Pill
    [Arguments]    ${month}
    RETURN    [data-testid="roster-month-${month}"]

Month Should Be
    [Arguments]    ${month}    ${status}
    ${pill}=    Month Status Pill    ${month}
    Wait For Elements State    ${pill}\[data-status="${status}"]    visible

Publish Month
    [Documentation]    Opens the month's menu, publishes, and confirms.
    [Arguments]    ${month}
    ${pill}=    Month Status Pill    ${month}
    Click    ${pill}
    Click    ${MONTH_PUBLISH}
    Click    ${CONFIRM_DIALOG_CONFIRM}
    Month Should Be    ${month}    published

Take Month Back To Draft
    [Documentation]    As an admin: back to draft, giving the reason the backend asks for.
    [Arguments]    ${month}    ${reason}
    ${pill}=    Month Status Pill    ${month}
    Click    ${pill}
    Click    ${MONTH_UNPUBLISH}
    Wait For Elements State    ${REASON_DIALOG}    visible
    Fill Text    ${REASON_INPUT}    ${reason}
    Click    ${REASON_SUBMIT}
    Wait For Elements State    ${REASON_DIALOG}    detached
    Month Should Be    ${month}    draft
