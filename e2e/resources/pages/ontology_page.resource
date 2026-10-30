*** Settings ***
Documentation       Page object for Reports › Ontology: the network of employees,
...                 capabilities, workstations and shifts, its type toggles, and the
...                 sidebar entry that leads there.

Resource            ../common.resource


*** Variables ***
${NAV_ONTOLOGY}             css=app-sidebar a[href$="/ontology"]
${ONTOLOGY_PAGE}            [data-testid="ontology-page"]
${ONTOLOGY_CANVAS}          [data-testid="ontology-canvas"]
${ONTOLOGY_LEGEND}          [data-testid="ontology-legend"]
# d3 draws one <g> per node; its test id is `ontology-node-<type>:<id>`.
${ANY_NODE}                 css=[data-testid^="ontology-node-"]
${SHIFT_NODE}               css=[data-testid^="ontology-node-shift:"]
${EMPLOYEE_NODE}            css=[data-testid^="ontology-node-emp:"]


*** Keywords ***
Open Ontology
    Open Page    ${APP_PATH}ontology
    Element Should Be Visible    ${ONTOLOGY_PAGE}

Ontology Entry Should Be Offered
    Element Should Be Visible    ${NAV_ONTOLOGY}

Ontology Entry Should Be Hidden
    [Documentation]    `plannerOnly` entries are dropped from the menu, not disabled.
    Element Should Not Exist    ${NAV_ONTOLOGY}

Network Should Be Drawn
    [Documentation]    At least one node is in the SVG and the legend explains them.
    Wait For Elements State    ${ANY_NODE} >> nth=0    attached    ${TIMEOUT}
    Element Should Be Visible    ${ONTOLOGY_LEGEND}

Toggle Node Type
    [Documentation]    `employee`, `capability`, `workstation` or `shift`.
    [Arguments]    ${type}
    Click    [data-testid="ontology-toggle-${type}"]

Node Type Should Be Shown
    [Arguments]    ${selector}
    Wait For Elements State    ${selector} >> nth=0    attached    ${TIMEOUT}

Node Type Should Be Hidden
    [Arguments]    ${selector}
    Element Should Not Exist    ${selector} >> nth=0
