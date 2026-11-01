*** Settings ***
Documentation       Page object for the overview (dashboard) page — the locators and
...                 the vocabulary a test uses to talk about it. Tests never write a
...                 selector themselves, so a markup change is fixed here once.
...
...                 Every locator is a `data-testid`, put on the page for exactly
...                 this purpose (ui/src/app/pages/dashboard/overview). Planners and
...                 admins get the planner overview, viewers their own.

Resource            ../common.resource
Library             DateTime


*** Variables ***
${OVERVIEW_PAGE}                [data-testid="overview-page"]
${OVERVIEW_MY_DAY}              [data-testid="overview-my-day"]
${OVERVIEW_LATEST_RUN}          [data-testid="overview-latest-run"]
${OVERVIEW_ACTIVITY}            [data-testid="overview-activity"]

# Planner overview
${OVERVIEW_PLANNER}             [data-testid="overview-planner"]
${OVERVIEW_NEEDS_YOU}           [data-testid="overview-needs-you"]
${NEEDS_YOU_ANSWERED}           ${OVERVIEW_NEEDS_YOU} >> css=[data-testid="needs-you-empty"], [data-testid^="needs-you-item-"], [data-testid^="needs-you-error-"]
${NEEDS_YOU_ERRORS}             [data-testid^="needs-you-error-"]
${OVERVIEW_COVERAGE_GRID}       [data-testid="overview-coverage-grid"]
${COVERAGE_GRID_ANSWERED}       ${OVERVIEW_COVERAGE_GRID} >> css=[data-testid="coverage-grid-summary"], [data-testid="coverage-grid-empty"], [data-testid="coverage-grid-error"]
${COVERAGE_GRID_ERROR}          [data-testid="coverage-grid-error"]
${COVERAGE_DAYS}                [data-testid^="coverage-day-"]
${COVERAGE_SHORT_CELLS}         ${OVERVIEW_COVERAGE_GRID} >> css=[data-short="true"]

# Viewer overview
${OVERVIEW_VIEWER}              [data-testid="overview-viewer"]
${OVERVIEW_MY_CHANGES}          [data-testid="overview-my-changes"]
${MY_CHANGES_ANSWERED}          ${OVERVIEW_MY_CHANGES} >> css=[data-testid="my-changes-empty"], [data-testid="my-changes-list"], [data-testid="my-changes-error"]
${MY_CHANGES_ERROR}             [data-testid="my-changes-error"]
${OVERVIEW_WISH_WINDOW}         [data-testid="overview-wish-window"]

# The Schedule's Day view, where the coverage grid's links land.
${SCHEDULE_DAY_VIEW}            [data-testid="day-view"]


*** Keywords ***
Open Overview Page
    Open Page    ${APP_PATH}
    Overview Page Should Be Open

Overview Page Should Be Open
    Element Should Be Visible    ${OVERVIEW_PAGE}

My Day Section Should Be Shown
    Element Should Be Visible    ${OVERVIEW_MY_DAY}

Latest Run Card Should Be Shown
    [Documentation]    The card is there whether or not a run exists — an empty
    ...                database shows the "no runs yet" line instead of a status.
    Element Should Be Visible    ${OVERVIEW_LATEST_RUN}

Recent Activity Card Should Be Shown
    Element Should Be Visible    ${OVERVIEW_ACTIVITY}

# ── Planner overview ─────────────────────────────────────────────

Planner Overview Should Be Shown
    Element Should Be Visible    ${OVERVIEW_PLANNER}
    Element Should Not Exist    ${OVERVIEW_VIEWER}

Needs You Should Have Loaded
    [Documentation]    The list shows its items or says nothing is waiting — which
    ...                it only does once every source answered — and no source
    ...                failed. What is open depends on the environment's data.
    Element Should Be Visible    ${NEEDS_YOU_ANSWERED} >> nth=0
    ${errors}=    Get Element Count    ${NEEDS_YOU_ERRORS}
    Should Be Equal As Integers    ${errors}    0    A Needs-you source could not be loaded

Coverage Grid Should Be Filled In
    [Documentation]    The grid answered with its summary (or the "no shift has a
    ...                minimum" line), not an error: the roster facts loaded.
    Element Should Be Visible    ${COVERAGE_GRID_ANSWERED} >> nth=0
    Element Should Not Exist    ${COVERAGE_GRID_ERROR}

Open Coverage Day
    [Documentation]    Clicks tomorrow's column header and checks the Schedule opens
    ...                on that day, in its Day view.
    ${testid}=    Get Attribute    ${COVERAGE_DAYS} >> nth=1    data-testid
    ${date}=    Evaluate    $testid.removeprefix('coverage-day-')
    Click    ${COVERAGE_DAYS} >> nth=1
    Schedule Should Open On Day    ${date}

Open First Short Coverage Cell
    [Documentation]    Clicks the first short cell and checks the Schedule opens on
    ...                its day. Skipped when the environment's roster has no
    ...                shortfall in the next seven days.
    ${count}=    Get Element Count    ${COVERAGE_SHORT_CELLS}
    Skip If    ${count} == 0    No shift is short in the next seven days of this roster.
    ${testid}=    Get Attribute    ${COVERAGE_SHORT_CELLS} >> nth=0    data-testid
    ${date}=    Evaluate    $testid.removeprefix('coverage-cell-')[:10]
    Click    ${COVERAGE_SHORT_CELLS} >> nth=0
    Schedule Should Open On Day    ${date}

Schedule Should Open On Day
    [Arguments]    ${date}
    Wait For Condition    Url    contains    kalender?date=${date}    timeout=${TIMEOUT}
    Element Should Be Visible    ${SCHEDULE_DAY_VIEW}

# ── Viewer overview ──────────────────────────────────────────────

Viewer Overview Should Be Shown
    [Documentation]    The viewer's own sections, and none of the planner's.
    Element Should Be Visible    ${OVERVIEW_VIEWER}
    My Day Section Should Be Shown
    Element Should Be Visible    ${MY_CHANGES_ANSWERED} >> nth=0
    Element Should Not Exist    ${MY_CHANGES_ERROR}
    Element Should Not Exist    ${OVERVIEW_PLANNER}
    Element Should Not Exist    ${OVERVIEW_NEEDS_YOU}
    Element Should Not Exist    ${OVERVIEW_COVERAGE_GRID}
    Element Should Not Exist    ${OVERVIEW_LATEST_RUN}
    Element Should Not Exist    ${OVERVIEW_ACTIVITY}

Wish Section Should Follow The Wish Window
    [Documentation]    Shown exactly while wishes can be placed — read from the
    ...                window the environment has, rather than assumed.
    ${response}=    Http    /api/v1/wish-settings
    Should Be Equal As Integers    ${response}[status]    200
    ${settings}=    Set Variable    ${response}[body]
    ${today}=    Get Current Date    result_format=%Y-%m-%d
    ${open}=    Evaluate
    ...    $settings['mode'] == 'enabled' or ($settings['mode'] == 'date_range' and $settings['window_end'] >= $today)
    IF    ${open}
        Element Should Be Visible    ${OVERVIEW_WISH_WINDOW}
    ELSE
        Element Should Not Exist    ${OVERVIEW_WISH_WINDOW}
    END
