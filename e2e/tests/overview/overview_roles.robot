*** Settings ***
Documentation       What the overview page offers depends on the role signed in.
...                 Administration entries — user management and the wish window —
...                 are admin-only, and a viewer must not be offered them.
...
...                 Each test signs in as a different account, so the suite opens a
...                 fresh browser context per test rather than sharing a session.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/overview_page.resource
Resource            ../../resources/pages/navigation.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Teardown       Log Out

Force Tags          overview    rbac


*** Test Cases ***
Admin Is Offered The Administration Entries
    [Documentation]    A shift-admin sees the user management and wish window
    ...                entries in the sidebar.
    Log In As    admin
    Open Overview Page
    Admin Only Entries Should Be Offered

Admin Reaches User Management From The Overview
    [Documentation]    The entry works, not just exists.
    Log In As    admin
    Open Overview Page
    Open Navigation Entry    ${NAV_USERS}    /users
    Element Should Be Visible    [data-testid="users-table"]

Viewer Is Not Offered The Administration Entries
    [Documentation]    The entries are dropped for a shift-viewer. The backend
    ...                refuses them regardless; this checks they are not offered in
    ...                the first place.
    Log In As    viewer
    Open Overview Page
    Admin Only Entries Should Be Hidden

Viewer Opening User Management Directly Is Told It Is Admin Only
    [Documentation]    The route can still be typed in, so the page has to say no
    ...                by itself rather than render an empty table.
    Log In As    viewer
    Open Page    ${APP_PATH}users
    Element Should Be Visible    [data-testid="users-forbidden"]
