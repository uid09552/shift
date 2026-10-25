*** Settings ***
Documentation       Page object for the capability list and its import dialog: choosing
...                 a file, reading what the dialog detected, assigning a column, and
...                 the result of the import.

Resource            ../common.resource


*** Variables ***
${CAPABILITY_ROW}           [data-testid="capability-row"]
${IMPORT_FILE_INPUT}        [data-testid="capabilities-import-file"]
${IMPORT_DIALOG}            [data-testid="import-dialog"]
${IMPORT_CONFIRM}           [data-testid="import-confirm"] button
${IMPORT_MISSING}           [data-testid="import-missing"]
${IMPORT_RESULT}            [data-testid="import-result"]


*** Keywords ***
Open Capabilities
    Open Page    ${APP_PATH}capabilities
    Wait For Elements State    css=app-capabilities    visible    ${TIMEOUT}

Choose Import File
    [Documentation]    Picks a file as the page's hidden file input would; the import
    ...                dialog opens on it.
    [Arguments]    ${path}
    Upload File By Selector    ${IMPORT_FILE_INPUT}    ${path}
    Element Should Be Visible    ${IMPORT_DIALOG}

Column Should Be Read As
    [Documentation]    The field the dialog reads column `${column}` (0-based) as;
    ...                an empty `${field}` means the column is ignored.
    [Arguments]    ${column}    ${field}
    Get Selected Options    [data-testid="import-field-${column}"]    value    ==    ${field}

Assign Column
    [Arguments]    ${column}    ${field}
    Select Options By    [data-testid="import-field-${column}"]    value    ${field}

Import Should Be Blocked
    [Documentation]    A required field has no column: the dialog says so and the
    ...                import button is disabled.
    Element Should Be Visible    ${IMPORT_MISSING}
    Wait For Elements State    ${IMPORT_CONFIRM}    disabled    ${TIMEOUT}

Import Should Be Possible
    Wait For Elements State    ${IMPORT_CONFIRM}    enabled    ${TIMEOUT}

Confirm Import
    Click    ${IMPORT_CONFIRM}
    Wait For Elements State    ${IMPORT_DIALOG}    detached    ${TIMEOUT}
    Element Should Be Visible    ${IMPORT_RESULT}

Import Result Should Be
    [Arguments]    ${created}    ${skipped}
    Get Attribute    ${IMPORT_RESULT}    data-created    ==    ${created}
    Get Attribute    ${IMPORT_RESULT}    data-skipped    ==    ${skipped}

Capability Should Be Listed
    [Arguments]    ${name}
    Element Should Be Visible    ${CAPABILITY_ROW}[data-capability="${name}"]
