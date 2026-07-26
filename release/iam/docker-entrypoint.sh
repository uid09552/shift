#!/usr/bin/env bash
#
# Keycloak entrypoint wrapper — renders the realm import template before
# starting Keycloak, substituting the ${...} placeholders in
# realm-shift.json.tpl with the matching environment variables (set by
# docker-compose.yml from .env).
#
# Mounted by docker-compose.yml as /docker-entrypoint-wrapper.sh together with
# the template at /opt/keycloak/data/import/realm-shift.json.tpl.
#
# Note: the values land inside a JSON document, so avoid double quotes and
# backslashes in them.
#
set -e

TPL=/opt/keycloak/data/import/realm-shift.json.tpl
CFG=/opt/keycloak/data/import/realm-shift.json

# Placeholders substituted in the template.
VARS="PUBLIC_URL MCP_OAUTH_CLIENT_SECRET KEYCLOAK_REALM_ADMIN_USER KEYCLOAK_REALM_ADMIN_PASSWORD"

# Replaces every occurrence of $2 in $1 with $3, treating both as literals.
# Deliberately not ${s//pat/repl}: bash 5.2 expands an "&" in the replacement
# to the matched text, which would mangle secrets containing one.
subst() {
  local s=$1 ph=$2 val=$3 out=""
  while [[ $s == *"$ph"* ]]; do
    out+="${s%%"$ph"*}$val"
    s=${s#*"$ph"}
  done
  printf '%s' "$out$s"
}

if [ -f "$TPL" ]; then
  echo "entrypoint: rendering realm import from $TPL"

  if command -v envsubst >/dev/null 2>&1; then
    envsubst < "$TPL" > "$CFG"
  else
    # The Keycloak image ships no gettext/envsubst — substitute in bash.
    content=$(<"$TPL")
    for var in $VARS; do
      content=$(subst "$content" "\${$var}" "${!var}")
    done
    printf '%s\n' "$content" > "$CFG"
  fi

  echo "entrypoint: wrote $CFG"
else
  echo "entrypoint: no template at $TPL, using static realm import if present"
fi

# Hand off to the original Keycloak entrypoint
exec /opt/keycloak/bin/kc.sh "$@"
