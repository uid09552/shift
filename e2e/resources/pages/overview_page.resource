*** Settings ***
Documentation       Page object for the overview (dashboard) page — the locators and
...                 the vocabulary a test uses to talk about it. Tests never write a
...                 selector themselves, so a markup change is fixed here once.
...
...                 Every locator is a `data-testid`, put on the page for exactly
...                 this purpose (ui/src/app/pages/dashboard/ecommerce).

Resource            ../common.resource


*** Variables ***
${OVERVIEW_PAGE}                [data-testid="overview-page"]
${OVERVIEW_MY_DAY}              [data-testid="overview-my-day"]
${OVERVIEW_PLANNED_HOURS}       [data-testid="overview-planned-hours"]
${OVERVIEW_COVERAGE}            [data-testid="overview-coverage"]
${OVERVIEW_LATEST_RUN}          [data-testid="overview-latest-run"]
${OVERVIEW_ACTIVITY}            [data-testid="overview-activity"]

${COVERAGE_WORKING}             [data-testid="coverage-working"]
${COVERAGE_ON_LEAVE}            [data-testid="coverage-leave"]

# The chart is drawn by ApexCharts inside the planned-hours card.
${PLANNED_HOURS_CHART}          ${OVERVIEW_PLANNED_HOURS} >> css=.apexcharts-canvas

# The three metric tiles, and where each one navigates to.
&{METRIC_TILES}
...    employees=[data-testid="metric-employees"]
...    shifts=[data-testid="metric-shifts"]
...    workstations=[data-testid="metric-workstations"]

&{METRIC_TARGETS}
...    employees=/user-profiles
...    shifts=/shifts
...    workstations=/workstations


*** Keywords ***
Open Overview Page
    Open Page    ${APP_PATH}
    Overview Page Should Be Open

Overview Page Should Be Open
    Element Should Be Visible    ${OVERVIEW_PAGE}

Get Metric Value
    [Documentation]    The number on one of the three tiles, as text.
    [Arguments]    ${metric}
    ${value}=    Get Text    [data-testid="metric-${metric}-value"]
    RETURN    ${value}

Metric Should Show A Number
    [Documentation]    The tile is filled in, whatever the count happens to be —
    ...                a fixed number would only hold for one seeded database.
    [Arguments]    ${metric}
    Element Should Be Visible    ${METRIC_TILES}[${metric}]
    ${value}=    Get Metric Value    ${metric}
    Should Match Regexp    ${value}    ^\\d+$
    ...    msg=The ${metric} tile shows '${value}' instead of a count

Open Metric Tile
    [Documentation]    Clicks a tile and waits for the page it links to.
    [Arguments]    ${metric}
    Click    ${METRIC_TILES}[${metric}]
    Wait For Condition    Url    contains    ${METRIC_TARGETS}[${metric}]    timeout=${TIMEOUT}

Coverage Card Should Be Filled In
    [Documentation]    Both counts of today's coverage have loaded. They are only
    ...                rendered once the requests come back, so this is also what
    ...                proves the dashboard's API calls succeeded.
    Element Should Be Visible    ${OVERVIEW_COVERAGE}
    Element Should Be Visible    ${COVERAGE_WORKING}
    ${working}=    Get Text    ${COVERAGE_WORKING}
    ${on_leave}=    Get Text    ${COVERAGE_ON_LEAVE}
    Should Match Regexp    ${working}    ^\\d+$
    Should Match Regexp    ${on_leave}    ^\\d+$

Planned Hours Chart Should Be Rendered
    Element Should Be Visible    ${OVERVIEW_PLANNED_HOURS}
    Element Should Be Visible    ${PLANNED_HOURS_CHART}

Latest Run Card Should Be Shown
    [Documentation]    The card is there whether or not a run exists — an empty
    ...                database shows the "no runs yet" line instead of a status.
    Element Should Be Visible    ${OVERVIEW_LATEST_RUN}

Recent Activity Card Should Be Shown
    Element Should Be Visible    ${OVERVIEW_ACTIVITY}

My Day Section Should Be Shown
    Element Should Be Visible    ${OVERVIEW_MY_DAY}
