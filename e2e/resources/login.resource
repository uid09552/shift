*** Settings ***
Documentation       Signing in and out. The app itself has no login form: the
...                 gateway redirects an unauthenticated request to Keycloak, and
...                 comes back to the app once the credentials are accepted.

Resource            common.resource


*** Variables ***
# Keycloak's login form. These ids are Keycloak's own and are stable across
# versions; they are the one place the tests depend on a page that is not ours.
${LOGIN_USERNAME}       id=username
${LOGIN_PASSWORD}       id=password
${LOGIN_SUBMIT}         id=kc-login
${LOGIN_ERROR}          css=#input-error, .alert-error


*** Keywords ***
Log In As
    [Documentation]    Signs in as one of the accounts in USERS (e.g. `admin`) and
    ...                waits until the application has loaded.
    ...
    ...                An already-authenticated session skips the form: the gateway
    ...                sends the browser straight through, which is why the form is
    ...                waited for optionally rather than required.
    [Arguments]    ${role}
    ${user}=    Set Variable    ${USERS}[${role}]
    New Page    ${BASE_URL}${APP_PATH}
    ${login_shown}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${LOGIN_USERNAME}    visible    ${LOGIN_TIMEOUT}
    IF    ${login_shown}
        Fill Text    ${LOGIN_USERNAME}    ${user}[username]
        Fill Text    ${LOGIN_PASSWORD}    ${user}[password]
        Click    ${LOGIN_SUBMIT}
    END
    Wait For Elements State    ${APP_ROOT}    visible    ${TIMEOUT}

Log Out
    [Documentation]    Ends the Keycloak session so the next login starts from the
    ...                form again. Failures are ignored: a test that already lost
    ...                its session should not fail in teardown.
    Run Keyword And Ignore Error    Go To    ${BASE_URL}${LOGOUT_PATH}
