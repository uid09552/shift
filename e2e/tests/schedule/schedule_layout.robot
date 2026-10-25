*** Settings ***
Documentation       The Schedule page fills the window: the grid (or the Day view's
...                 chart) is the one thing that scrolls, the page itself does not.
...                 At the configured window size, in each view.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/schedule_page.resource

Suite Setup         Open Application
Suite Teardown      Close Application
Test Teardown       Log Out

Force Tags          schedule    layout


*** Test Cases ***
The Page Itself Does Not Scroll
    [Tags]    smoke
    Log In As    admin
    Open Schedule Page
    FOR    ${view}    IN    week    month    day
        Show Schedule View    ${view}
        Page Should Not Scroll
    END
