{
  "realm": "shift",
  "displayName": "Shift Hospital",
  "enabled": true,
  "sslRequired": "none",
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "editUsernameAllowed": false,
  "bruteForceProtected": true,
  "defaultSignatureAlgorithm": "RS256",
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "organizationsEnabled": true,
  "organizations": [
    {
      "name": "0",
      "alias": "0",
      "enabled": true,
      "domains": [
        { "name": "shift.local", "verified": false }
      ],
      "members": [{ "username": "${KEYCLOAK_REALM_ADMIN_USER}" }]
    }
  ],
  "clientScopes": [
    {
      "name": "shift-org",
      "description": "Organization membership claim, requested by the gateway to scope sessions to a tenant",
      "protocol": "openid-connect",
      "attributes": {
        "include.in.token.scope": "true",
        "display.on.consent.screen": "false"
      },
      "protocolMappers": [
        {
          "name": "Organization Membership",
          "protocol": "openid-connect",
          "protocolMapper": "oidc-organization-membership-mapper",
          "consentRequired": false,
          "config": {
            "claim.name": "tenant",
            "jsonType.label": "String",
            "multivalued": "true",
            "id.token.claim": "true",
            "access.token.claim": "true",
            "userinfo.token.claim": "true",
            "introspection.token.claim": "true",
            "addOrganizationAttributes": "false",
            "addOrganizationId": "false",
            "addOrganizationDomain": "false"
          }
        }
      ]
    }
  ],
  "clients": [
    {
      "clientId": "shift-gateway",
      "name": "Shift Gateway",
      "description": "Confidential client for the APISIX gateway (authorization code flow), for service accounts (e.g. the agent's client-credentials fallback), and as the upstream client for the MCP server's OAuth proxy",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "secret": "${MCP_OAUTH_CLIENT_SECRET}",
      "standardFlowEnabled": true,
      "implicitFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "serviceAccountsEnabled": true,
      "redirectUris": [
        "${PUBLIC_URL}/callback",
        "${PUBLIC_URL}:8900/auth/callback"
      ],
      "webOrigins": [
        "${PUBLIC_URL}",
        "${PUBLIC_URL}:8900"
      ],
      "attributes": {
        "post.logout.redirect.uris": "${PUBLIC_URL}/*"
      },
      "defaultClientScopes": [
        "web-origins",
        "acr",
        "shift-org",
        "roles",
        "profile",
        "basic",
        "email"
      ]
    }
  ],
  "roles": {
    "realm": [
      {
        "name": "shift-admin",
        "description": "Hospital administrator"
      },
      {
        "name": "shift-planner",
        "description": "Shift planner / scheduler"
      },
      {
        "name": "shift-viewer",
        "description": "Read-only access to schedules"
      }
    ]
  },
  "users": [
    {
      "username": "${KEYCLOAK_REALM_ADMIN_USER}",
      "email": "admin@shift.local",
      "firstName": "Admin",
      "lastName": "User",
      "enabled": true,
      "emailVerified": true,
      "credentials": [
        {
          "type": "password",
          "value": "${KEYCLOAK_REALM_ADMIN_PASSWORD}",
          "temporary": false
        }
      ],
      "realmRoles": ["shift-admin", "shift-planner"]
    }
  ]
}
