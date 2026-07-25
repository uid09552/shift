#!/bin/sh
#
# Keycloak entrypoint wrapper — substitutes ${MCP_OAUTH_CLIENT_SECRET} (and
# other env vars) in the realm import JSON before starting Keycloak.
#
# Usage: docker run ... quay.io/keycloak/keycloak
#   Mount realm-shift.json.tpl to /opt/keycloak/data/import/realm-shift.json.tpl
#   Set MCP_OAUTH_CLIENT_SECRET (and any other referenced vars) in the environment.
#

set -e

TPL=/opt/keycloak/data/import/realm-shift.json.tpl
CFG=/opt/keycloak/data/import/realm-shift.json

if [ -f "$TPL" ]; then
  echo "entrypoint: substituting env vars in realm import JSON"
  envsubst < "$TPL" > "$CFG"
  echo "entrypoint: wrote $CFG"
else
  echo "entrypoint: no template found at $TPL, using static realm import"
fi

# Hand off to the original Keycloak entrypoint
exec /opt/keycloak/bin/kc.sh "$@"
