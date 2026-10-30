*** Settings ***
Documentation       Reports › Ontology draws who can work where as a network. It
...                 is for planners and admins: it shows every colleague's
...                 qualifications, so a viewer is neither offered it nor shown it.
...
...                 Each test signs in as a different account, so the suite opens a
...                 fresh browser context per test rather than sharing a session.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/ontology_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Teardown       Log Out

Force Tags          reports    ontology


*** Test Cases ***
Admin Opens Ontology From The Sidebar
    [Documentation]    The Reports group lists Ontology, and the entry leads
    ...                to a drawn network with its legend.
    [Tags]    smoke
    Log In As    admin
    Ontology Entry Should Be Offered
    Click    ${NAV_ONTOLOGY}
    Wait For Condition    Url    contains    /ontology    timeout=${TIMEOUT}
    Network Should Be Drawn

Shifts Start Hidden And Can Be Shown And Hidden Again
    [Documentation]    Shifts connect to nearly everything, so they start hidden;
    ...                the toggle brings them in and takes them out again, and the
    ...                other node types stay.
    Log In As    admin
    Open Ontology
    Network Should Be Drawn
    Node Type Should Be Hidden    ${SHIFT_NODE}
    Toggle Node Type    shift
    Node Type Should Be Shown    ${SHIFT_NODE}
    Toggle Node Type    shift
    Node Type Should Be Hidden    ${SHIFT_NODE}
    Node Type Should Be Shown    ${EMPLOYEE_NODE}

Viewer Is Not Offered Ontology
    Log In As    viewer
    Ontology Entry Should Be Hidden

Viewer Opening Ontology Directly Lands On The Overview
    [Documentation]    The route can still be typed in; the guard sends a viewer
    ...                to the overview instead of showing the page.
    Log In As    viewer
    Open Page    ${APP_PATH}ontology
    Wait For Condition    Url    not contains    /ontology    timeout=${TIMEOUT}
    Element Should Not Exist    ${ONTOLOGY_PAGE}

Old Relationships Address Leads To Ontology
    [Documentation]    The page was called Relationships; links and bookmarks to
    ...                the old address still open it.
    Log In As    admin
    Open Page    ${APP_PATH}relationships
    Wait For Condition    Url    contains    /ontology    timeout=${TIMEOUT}
    Element Should Be Visible    ${ONTOLOGY_PAGE}
