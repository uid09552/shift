*** Settings ***
Documentation       Page object for Reports › Relationships: the network of employees,
...                 capabilities, workstations and shifts, its type toggles, and the
...                 sidebar entry that leads there.

Resource            ../common.resource


*** Variables ***
${NAV_RELATIONSHIPS}        css=app-sidebar a[href$="/relationships"]
${RELATIONSHIPS_PAGE}       [data-testid="relationships-page"]
${RELATIONSHIPS_CANVAS}     [data-testid="relationships-canvas"]
${RELATIONSHIPS_LEGEND}     [data-testid="relationships-legend"]
# d3 draws one <g> per node; its test id is `relationships-node-<type>:<id>`.
${ANY_NODE}                 css=[data-testid^="relationships-node-"]
${SHIFT_NODE}               css=[data-testid^="relationships-node-shift:"]
${EMPLOYEE_NODE}            css=[data-testid^="relationships-node-emp:"]


*** Keywords ***
Open Relationships
    Open Page    ${APP_PATH}relationships
    Element Should Be Visible    ${RELATIONSHIPS_PAGE}

Relationships Entry Should Be Offered
    Element Should Be Visible    ${NAV_RELATIONSHIPS}

Relationships Entry Should Be Hidden
    [Documentation]    `plannerOnly` entries are dropped from the menu, not disabled.
    Element Should Not Exist    ${NAV_RELATIONSHIPS}

Network Should Be Drawn
    [Documentation]    At least one node is in the SVG and the legend explains them.
    Wait For Elements State    ${ANY_NODE} >> nth=0    attached    ${TIMEOUT}
    Element Should Be Visible    ${RELATIONSHIPS_LEGEND}

Toggle Node Type
    [Documentation]    `employee`, `capability`, `workstation` or `shift`.
    [Arguments]    ${type}
    Click    [data-testid="relationships-toggle-${type}"]

Node Type Should Be Shown
    [Arguments]    ${selector}
    Wait For Elements State    ${selector} >> nth=0    attached    ${TIMEOUT}

Node Type Should Be Hidden
    [Arguments]    ${selector}
    Element Should Not Exist    ${selector} >> nth=0
