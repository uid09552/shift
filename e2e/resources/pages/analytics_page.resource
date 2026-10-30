*** Settings ***
Documentation       Page object for Reports › Analytics: the filter bar, the chips of
...                 what narrows the view, the tabs, the charts and the detail table.

Resource            ../common.resource


*** Variables ***
${NAV_ANALYTICS}            css=app-sidebar a[href$="/analytics"]
${ANALYTICS_PAGE}           [data-testid="analytics-page"]
${ANALYTICS_CHIP}           css=[data-testid="analytics-chip"]
${ANALYTICS_CHIP_REMOVE}    css=[data-testid="analytics-chip-remove"]
${ANALYTICS_TABLE_COUNT}    [data-testid="analytics-table-count"]
${ANALYTICS_TABLE_ROW}      css=[data-testid="analytics-table-row"]
# ECharts draws on a canvas; a click in the middle of the calendar lands on a day.
${HEATMAP_CANVAS}           css=[data-testid="analytics-chart-heatmap"] canvas
${AUDIT_LINK}               css=[data-testid="analytics-table-link-action"]


*** Keywords ***
Open Analytics
    Open Page    ${APP_PATH}analytics
    Element Should Be Visible    ${ANALYTICS_PAGE}

Analytics Entry Should Be Offered
    Element Should Be Visible    ${NAV_ANALYTICS}

Analytics Entry Should Be Hidden
    [Documentation]    `plannerOnly` entries are dropped from the menu, not disabled.
    Element Should Not Exist    ${NAV_ANALYTICS}

Choose Period Preset
    [Documentation]    `thisMonth`, `lastMonth`, `thisQuarter`, `last3Months`, `last12Months`.
    [Arguments]    ${preset}
    Click    [data-testid="analytics-filter-preset-${preset}"]
    Get Attribute    [data-testid="analytics-filter-preset-${preset}"]    aria-pressed    ==    true

Filter By First Option
    [Documentation]    Opens a filter (`workstation`, `shift`, …) and ticks its first value.
    [Arguments]    ${dim}
    Click    [data-testid="analytics-filter-${dim}"]
    Click    css=[data-testid="analytics-filter-${dim}-option"] >> nth=0
    Keyboard Key    press    Escape

Open Analytics Tab
    [Documentation]    `coverage`, `hours`, `absences`, `changes`, `audit` or `runs`.
    [Arguments]    ${tab}
    Click    id=analytics-${tab}
    Element Should Be Visible    [data-testid="analytics-panel-${tab}"]

Click Heatmap Day
    Wait For Elements State    ${HEATMAP_CANVAS}    visible    ${TIMEOUT}
    Click    ${HEATMAP_CANVAS}

Chip Count Should Be
    [Arguments]    ${count}
    Get Element Count    ${ANALYTICS_CHIP}    ==    ${count}

Table Count Text
    ${text}=    Get Text    ${ANALYTICS_TABLE_COUNT}
    RETURN    ${text}

Remove Last Chip
    Click    ${ANALYTICS_CHIP_REMOVE} >> nth=-1
