#!/bin/bash
# bootstrap.sh - Zitadel bootstrap and APISIX gateway configuration
# Uses Zitadel v2 API endpoints

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

APISIX_ADMIN_URL="${APISIX_ADMIN_URL:-http://localhost:9180}"
ZITADEL_API_URL="${ZITADEL_API_URL:-http://localhost}"
APISIX_API_KEY="${APISIX_API_KEY:-edd1c9f034335f136f87ad84b625c8f1}"
ORG_NAME="${ORG_NAME:-planner}"; PROJECT_NAME="${PROJECT_NAME:-planner}"
SESSION_SECRET="${SESSION_SECRET:-geheimgeheimgeheimgeheim12345678}"
REDIRECT_URI="${REDIRECT_URI:-http://localhost/callback}"
POST_LOGOUT_URI="${POST_LOGOUT_URI:-http://localhost/}"

check_zitadel() {
    log_info "Checking Zitadel at $ZITADEL_API_URL..."
    curl -s -f "$ZITADEL_API_URL/.well-known/openid-configuration" > /dev/null 2>&1 || { log_error "Zitadel not accessible"; exit 1; }
    log_info "Zitadel is healthy"
}
check_admin_pat() { [ ! -f .zitadel-admin.pat ] && { log_error "Admin PAT not found"; exit 1; }; }

create_org() {
    log_info "Creating organization '$ORG_NAME'..."
    check_zitadel; check_admin_pat
    # Use v2beta API endpoint
    curl -s -X POST "$ZITADEL_API_URL/v2beta/organizations" \
        -H "Authorization: Bearer $(cat .zitadel-admin.pat)" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$ORG_NAME\"}" > .org-response.json 2>&1
    grep -q '"id"' .org-response.json && log_info "Organization created" || log_warn "May already exist"
    cat .org-response.json
}

create_project() {
    log_info "Creating project '$PROJECT_NAME'..."
    ORG_ID=$(grep -o '"id":"[^"]*"' .org-response.json | head -1 | cut -d'"' -f4)
    [ -z "$ORG_ID" ] && { log_error "No organization ID"; exit 1; }
    log_info "Organization ID: $ORG_ID"
    # Use v2beta API endpoint
    curl -s -X POST "$ZITADEL_API_URL/v2beta/projects" \
        -H "Authorization: Bearer $(cat .zitadel-admin.pat)" \
        -H "Content-Type: application/json" \
        -d "{\"name\": \"$PROJECT_NAME\"}" > .project-response.json 2>&1
    grep -q '"id"' .project-response.json && log_info "Project created" || log_warn "May already exist"
    cat .project-response.json
}

create_client() {
    log_info "Creating OIDC client..."
    PROJECT_ID=$(grep -o '"id":"[^"]*"' .project-response.json | head -1 | cut -d'"' -f4)
    [ -z "$PROJECT_ID" ] && { log_error "No project ID"; exit 1; }
    log_info "Project ID: $PROJECT_ID"
    # Use v2beta API endpoint for creating OIDC app
    curl -s -X POST "$ZITADEL_API_URL/v2beta/projects/$PROJECT_ID/apps/oidc" \
        -H "Authorization: Bearer $(cat .zitadel-admin.pat)" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"gateway-client\",\"redirectUris\":[\"$REDIRECT_URI\"],\"postLogoutRectUris\":[\"$POST_LOGOUT_URI\"],\"responseTypes\":[\"OIDC_RESPONSE_TYPE_CODE\"],\"grantTypes\":[\"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\",\"OIDC_GRANT_TYPE_REFRESH_TOKEN\"],\"authMethodType\":\"OIDC_AUTH_METHOD_TYPE_BASIC\"}" > .client-response.json 2>&1
    cat .client-response.json
    CLIENT_ID=$(grep -o '"clientId":"[^"]*"' .client-response.json | cut -d'"' -f4)
    CLIENT_SECRET=$(grep -o '"clientSecret":"[^"]*"' .client-response.json | cut -d'"' -f4)
    [ -n "$CLIENT_ID" ] && [ -n "$CLIENT_SECRET" ] && { echo "CLIENT_ID=$CLIENT_ID" > .client-credentials.env; echo "CLIENT_SECRET=$CLIENT_SECRET" >> .client-credentials.env; echo "PROJECT_ID=$PROJECT_ID" >> .client-credentials.env; log_info "Credentials saved"; } || { log_error "Failed to extract credentials"; exit 1; }
}

configure_gateway() {
    log_info "Configuring APISIX gateway..."
    [ ! -f .client-credentials.env ] && { log_error "No credentials"; exit 1; }
    source .client-credentials.env
    log_info "CLIENT_ID: $CLIENT_ID"
    log_info "Configuring bypass routes..."
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/100" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/ui/*","name":"zitadel-ui-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/101" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/ui/v2/login/*","name":"zitadel-login-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-login:3000":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/102" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/.well-known/*","name":"zitadel-wellknown-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/103" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/zitadel/*","name":"zitadel-internal-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/104" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/oauth/*","name":"zitadel-oauth-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/105" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/oidc/*","name":"zitadel-oidc-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/106" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/saml/*","name":"zitadel-saml-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/107" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/auth/*","name":"zitadel-auth-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/108" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/debug/*","name":"zitadel-debug-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/109" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d '{"uri":"/v2beta/*","name":"zitadel-v2beta-bypass","priority":100,"upstream":{"type":"roundrobin","nodes":{"zitadel-api:8080":1}}}' > /dev/null
    log_info "Bypass routes configured"
    log_info "Configuring OIDC protected route for /api..."
    curl -s -X PUT "$APISIX_ADMIN_URL/apisix/admin/routes/10" -H "X-API-KEY: $APISIX_API_KEY" -H "Content-Type: application/json" -d "{\"uri\":\"/api/*\",\"name\":\"api-oidc-protected\",\"priority\":10,\"plugins\":{\"openid-connect\":{\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"discovery\":\"$ZITADEL_API_URL/.well-known/openid-configuration\",\"scope\":\"openid profile email\",\"bearer_only\":false,\"redirect_uri\":\"$REDIRECT_URI\",\"post_logout_redirect_uri\":\"$POST_LOGOUT_URI\",\"session\":{\"secret\":\"$SESSION_SECRET\"}}},\"upstream\":{\"type\":\"roundrobin\",\"nodes\":{\"backend:8080\":1}}}" > /dev/null
    log_info "Gateway configuration complete"
}

clean_gateway() {
    log_info "Removing APISIX routes..."
    for i in 10 11 100 101 102 103 104 105 106 107 108 109; do curl -s -X DELETE "$APISIX_ADMIN_URL/apisix/admin/routes/$i" -H "X-API-KEY: $APISIX_API_KEY" 2>/dev/null || true; done
    log_info "Gateway routes removed"
}

clean_local() { log_info "Removing local files..."; rm -f .org-response.json .project-response.json .client-response.json .client-credentials.env; log_info "Local files removed"; }

bootstrap() { create_org; create_project; create_client; configure_gateway; log_info "Bootstrap complete!"; cat .client-credentials.env; }
down() { clean_gateway; clean_local; log_info "Cleanup complete!"; }

case "${1:-help}" in
    bootstrap) bootstrap ;;
    down) down ;;
    create-org) create_org ;;
    create-project) create_project ;;
    create-client) create_client ;;
    configure-gateway) configure_gateway ;;
    clean-gateway) clean_gateway ;;
    clean-local) clean_local ;;
    *) echo "Usage: $0 {bootstrap|down|create-org|create-project|create-client|configure-gateway|clean-gateway|clean-local}" ;;
esac
