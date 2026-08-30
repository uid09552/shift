*** Settings ***
Documentation       Shared setup for every suite: the browser library, the settings
...                 from config/config.yaml, and the browser lifecycle keywords.
...
...                 Import this rather than the Browser library directly, so a suite
...                 never has to know where the configuration comes from.

# The variable file comes first on purpose: settings are processed top to bottom,
# so anything imported below can use the values it defines.
Variables           ${CURDIR}/../config/config.yaml
Library             Browser


*** Variables ***
# The Angular application root — present on every page of the app, so it is what
# "the app finished loading" is checked against.
${APP_ROOT}                     css=app-root


*** Keywords ***
Open Application
    [Documentation]    Opens a fresh browser with its own context, so cookies and
    ...                the Keycloak session of one suite cannot leak into the next.
    Set Browser Timeout    ${TIMEOUT}
    New Browser    ${BROWSER}    headless=${HEADLESS}
    New Context    viewport={'width': ${VIEWPORT_WIDTH}, 'height': ${VIEWPORT_HEIGHT}}

Close Application
    [Documentation]    Ends the browser session. Safe to call when nothing is open.
    Run Keyword And Ignore Error    Close Browser    ALL

Open Page
    [Documentation]    Navigates to a path below BASE_URL and waits for the app.
    [Arguments]    ${path}
    Go To    ${BASE_URL}${path}
    Wait For Elements State    ${APP_ROOT}    visible    ${TIMEOUT}

Element Should Be Visible
    [Documentation]    Reads better in a test than the raw state assertion, and
    ...                gives the same waiting behaviour.
    [Arguments]    ${selector}
    Wait For Elements State    ${selector}    visible    ${TIMEOUT}

Element Should Not Exist
    [Arguments]    ${selector}
    Wait For Elements State    ${selector}    detached    ${TIMEOUT}
