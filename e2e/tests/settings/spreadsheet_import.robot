*** Settings ***
Documentation       Importing capabilities from a spreadsheet whose columns are not in
...                 the template's order: the import dialog shows how the file would
...                 be read, the planner corrects what was not recognised, and what
...                 the file holds ends up in the list.
...
...                 Each run uses capability names of its own and removes them again,
...                 through the API, whether the test passed or not.

Resource            ../../resources/common.resource
Resource            ../../resources/login.resource
Resource            ../../resources/pages/capabilities_page.resource
Library             OperatingSystem
Library             ../../resources/libraries/workbooks.py

Suite Setup         Open Application
Suite Teardown      Close Application
Test Setup          Prepare Import Data
Test Teardown       Remove Import Data

Force Tags          settings    import


*** Test Cases ***
Columns Are Found By Their Header Whatever Their Order
    [Documentation]    A title row, an unrelated first column and the names under a
    ...                German header: nothing to assign, the dialog already reads the
    ...                right column as the name.
    Create Import File
    ...    [["Qualifikationsliste"], [], ["Anmerkung", "Bezeichnung"], ["x", "${PREFIX} A"], ["y", "${PREFIX} B"]]
    Log In As    admin
    Open Capabilities
    Choose Import File    ${IMPORT_FILE}
    Column Should Be Read As    0    ${EMPTY}
    Column Should Be Read As    1    name
    Import Should Be Possible
    Confirm Import
    Import Result Should Be    2    0
    Capability Should Be Listed    ${PREFIX} A
    Capability Should Be Listed    ${PREFIX} B

A Column Nothing Recognises Can Be Assigned By Hand
    [Documentation]    "Station" is not a name the import knows: it is refused until
    ...                the planner says that column holds the names.
    Create Import File    [["Station"], ["${PREFIX} C"], ["${PREFIX} D"]]
    Log In As    admin
    Open Capabilities
    Choose Import File    ${IMPORT_FILE}
    Column Should Be Read As    0    ${EMPTY}
    Import Should Be Blocked
    Assign Column    0    name
    Import Should Be Possible
    Confirm Import
    Import Result Should Be    2    0
    Capability Should Be Listed    ${PREFIX} C


*** Keywords ***
Prepare Import Data
    ${suffix}=    Evaluate    __import__('uuid').uuid4().hex[:8]
    Set Test Variable    ${PREFIX}    E2E Import ${suffix}
    Set Test Variable    ${IMPORT_FILE}    ${TEMPDIR}${/}e2e-import-${suffix}.xlsx

Create Import File
    [Documentation]    Writes `${rows}`, a JSON list of rows, to the import file.
    [Arguments]    ${rows}
    ${table}=    Evaluate    json.loads($rows)    modules=json
    Create Workbook    ${IMPORT_FILE}    ${table}

Remove Import Data
    [Documentation]    Deletes whatever this run created, by its name prefix, and the
    ...                file; then ends the session.
    Run Keyword And Ignore Error    Delete Capabilities Named    ${PREFIX}
    Run Keyword And Ignore Error    Remove File    ${IMPORT_FILE}
    Run Keyword And Ignore Error    Log Out

Delete Capabilities Named
    [Arguments]    ${prefix}
    ${response}=    Http    /api/v1/capabilities    GET
    ${capabilities}=    Set Variable    ${response}[body]
    FOR    ${capability}    IN    @{capabilities}
        IF    $capability['name'].startswith($prefix)
            Http    /api/v1/capabilities/${capability}[id]    DELETE
        END
    END
