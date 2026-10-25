*** Settings ***
Documentation       Page object for the employee calendar (ui/src/app/pages/planner/
...                 employee-calendar): the month grid, and recording an absence on it
...                 — absence mode, the days, the type boxes, and the list below.

Resource            ../common.resource


*** Variables ***
${ABSENCE_MODE_BUTTON}      [data-testid="absence-mode-button"]
${ABSENCE_PANEL}            [data-testid="absence-panel"]
${ABSENCE_ADD}              [data-testid="absence-add"]
${ABSENCE_LIST}             [data-testid="absence-list"]
${NEXT_MONTH}               [data-testid="calendar-nav-next"]


*** Keywords ***
Open Employee Calendar
    [Arguments]    ${employee_id}
    Open Page    ${APP_PATH}employee-calendar?employeeId=${employee_id}
    Wait For Elements State    css=app-employee-calendar    visible    ${TIMEOUT}

Go Forward Months
    [Arguments]    ${months}
    FOR    ${i}    IN RANGE    ${months}
        Click    ${NEXT_MONTH}
    END

Start Adding An Absence
    Click    ${ABSENCE_MODE_BUTTON}
    Element Should Be Visible    ${ABSENCE_PANEL}

Pick Days
    [Documentation]    The first and the last day (YYYY-MM-DD) of the absence, on the grid.
    [Arguments]    ${first}    ${last}
    Click    [data-testid="absence-day-${first}"]
    Click    [data-testid="absence-day-${last}"]

Choose Absence Type
    [Documentation]    `unavailable`, `day_off` (vacation) or `sick`.
    [Arguments]    ${type}
    Click    [data-testid="toggle-box-${type}"]
    Get Attribute    [data-testid="toggle-box-${type}"]    aria-checked    ==    true

Add The Absence
    Click    ${ABSENCE_ADD}
    Wait For Elements State    ${ABSENCE_PANEL}    detached    ${TIMEOUT}

Absence Should Be Listed
    [Arguments]    ${first_day}    ${type}
    Element Should Be Visible    ${ABSENCE_LIST} >> [data-testid="absence-row"][data-start="${first_day}"][data-type="${type}"]

Add Absence Should Not Be Offered
    Element Should Be Visible    css=app-employee-calendar
    Element Should Not Exist    ${ABSENCE_MODE_BUTTON}
