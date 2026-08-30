*** Settings ***
Documentation       The overview (dashboard) page — the first screen after signing
...                 in. These tests check that every card on it renders with real
...                 data from the backend, and that its links go where they say.
...
...                 The suite signs in once and reuses the session; each test is
...                 still independent, because every one of them opens the overview
...                 page for itself.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/overview_page.resource
Resource            ../../resources/pages/navigation.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Setup          Sign In And Open Overview

Force Tags          overview


*** Test Cases ***
Overview Page Loads After Sign In
    [Documentation]    The page a signed-in user lands on renders at all.
    [Tags]    smoke
    Overview Page Should Be Open
    Sidebar Should Be Shown

Metric Tiles Show Counts
    [Documentation]    All three tiles have their number filled in from the API.
    ...                The value itself is not asserted — it depends on the data in
    ...                the target environment — only that a count arrived.
    [Tags]    smoke
    Metric Should Show A Number    employees
    Metric Should Show A Number    shifts
    Metric Should Show A Number    workstations

My Day Section Is Shown
    [Documentation]    The signed-in user's own plan, the first thing on the page.
    My Day Section Should Be Shown

Planned Hours Chart Is Rendered
    [Documentation]    The chart is drawn, not just its card — an empty canvas
    ...                would mean the analysis endpoint failed.
    Planned Hours Chart Should Be Rendered

Todays Coverage Is Filled In
    [Documentation]    Working and on-leave counts have both loaded.
    Coverage Card Should Be Filled In

Latest Optimizer Run Card Is Shown
    Latest Run Card Should Be Shown

Recent Activity Card Is Shown
    Recent Activity Card Should Be Shown

Employees Tile Opens The Employee List
    [Documentation]    The tiles are links; this one proves they navigate.
    [Tags]    navigation
    Open Metric Tile    employees

Shifts Tile Opens The Shift Configuration
    [Tags]    navigation
    Open Metric Tile    shifts

Workstations Tile Opens The Workstation Configuration
    [Tags]    navigation
    Open Metric Tile    workstations


*** Keywords ***
Sign In And Open Overview
    Log In As    admin
    Open Overview Page
