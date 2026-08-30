*** Settings ***
Documentation       Page object for the sidebar: what it offers, and what it hides
...                 from roles that may not use it.

Resource            ../common.resource


*** Variables ***
${SIDEBAR}                  css=app-sidebar
# Entries are ordinary router links, so their href is the stable handle.
${NAV_USERS}                css=app-sidebar a[href$="/users"]
${NAV_WISH_SETTINGS}        css=app-sidebar a[href$="/wish-settings"]
${NAV_SHIFTS}               css=app-sidebar a[href$="/shifts"]


*** Keywords ***
Sidebar Should Be Shown
    Element Should Be Visible    ${SIDEBAR}

Admin Only Entries Should Be Offered
    [Documentation]    The user-management and wish-window entries are `adminOnly`
    ...                in the sidebar's own configuration.
    Element Should Be Visible    ${NAV_USERS}
    Element Should Be Visible    ${NAV_WISH_SETTINGS}

Admin Only Entries Should Be Hidden
    [Documentation]    They are dropped from the menu, not merely disabled, so the
    ...                assertion is that the links do not exist at all.
    Element Should Not Exist    ${NAV_USERS}
    Element Should Not Exist    ${NAV_WISH_SETTINGS}

Open Navigation Entry
    [Arguments]    ${selector}    ${expected_path}
    Click    ${selector}
    Wait For Condition    Url    contains    ${expected_path}    timeout=${TIMEOUT}
