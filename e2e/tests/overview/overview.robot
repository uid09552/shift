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

Admin Gets The Planner Overview
    [Documentation]    Planners and admins land on what needs them, not on a
    ...                viewer's page.
    [Tags]    smoke
    Planner Overview Should Be Shown

Needs You Has Loaded
    [Documentation]    Every source of the list answered. Which items are open
    ...                depends on the data in the target environment, so only that
    ...                the list loaded is asserted.
    [Tags]    smoke
    Needs You Should Have Loaded

Coverage Grid Is Filled In
    [Documentation]    The next seven days by shift, from the roster facts.
    Coverage Grid Should Be Filled In

A Day Of The Coverage Grid Opens That Day In The Schedule
    [Tags]    navigation
    Coverage Grid Should Be Filled In
    Open Coverage Day

A Short Cell Opens Its Day In The Schedule
    [Documentation]    Skipped when nothing is short in the coming week.
    [Tags]    navigation
    Coverage Grid Should Be Filled In
    Open First Short Coverage Cell

My Day Section Is Shown
    [Documentation]    The signed-in user's own plan.
    My Day Section Should Be Shown

Latest Optimizer Run Card Is Shown
    Latest Run Card Should Be Shown

Recent Activity Card Is Shown
    Recent Activity Card Should Be Shown


*** Keywords ***
Sign In And Open Overview
    Log In As    admin
    Open Overview Page
