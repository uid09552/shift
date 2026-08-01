.PHONY: install sync chat api api-custom api-debug mcp mcp-http mcp-token knowledge test-api clean help

# Default target
all: install

# Install uv if not present, then sync dependencies
install:
	@which uv > /dev/null 2>&1 || (curl -LsSf https://astral.sh/uv/install.sh | sh)
	uv sync

# Sync dependencies (use after editing pyproject.toml)
sync:
	uv sync

# Interactive terminal chat with the agent
chat:
	uv run shift-agent chat

# Start the REST API server (default: 0.0.0.0:8899)
api:
	uv run shift-agent api

# Start the REST API with custom host/port
api-custom:
	uv run shift-agent api --host 127.0.0.1 --port 8080

# Start the REST API in debug mode
api-debug:
	uv run shift-agent api --debug

# Start the MCP server (stdio transport, for Claude Code/Desktop etc.)
mcp:
	uv run shift-agent mcp

# Start the MCP server over streamable HTTP instead of stdio
mcp-http:
	uv run shift-agent mcp --transport http --port 8900

# Fetch an access token for the HTTP MCP server (client credentials grant,
# using MCP_OAUTH_CLIENT_ID/SECRET from .env) — prints only the token, so
# it's usable as: curl -H "Authorization: Bearer $$(make -s mcp-token)" ...
mcp-token:
	@set -a && . ./.env && set +a && \
	curl -s -X POST "$$KEYCLOAK_REALM_URL/protocol/openid-connect/token" \
		-d "grant_type=client_credentials" \
		-d "client_id=$$MCP_OAUTH_CLIENT_ID" \
		-d "client_secret=$$MCP_OAUTH_CLIENT_SECRET" \
	| python3 -c "\
import json, sys; \
d = json.load(sys.stdin); \
sys.exit(json.dumps(d)) if 'access_token' not in d else print(d['access_token'])"

# List the documentation bundle the agent answers product questions from —
# the quickest check that SHIFT_AGENT_KNOWLEDGE_PATH resolves. Pass a question
# to see what searchKnowledge would return: make knowledge Q="why is it infeasible"
knowledge:
	uv run shift-agent knowledge $(if $(Q),"$(Q)",)

# Quick smoke test of the API (no auth)
test-api:
	@echo "Starting API server for testing..."
	@uv run shift-agent api --port 5199 &
	@sleep 3
	@echo "--- Health check ---"
	@curl -s http://localhost:5199/api/v1/health | python3 -m json.tool
	@echo ""
	@echo "--- Chat request (no auth) ---"
	@curl -s -X POST http://localhost:5199/api/v1/chat -H "Content-Type: application/json" \
		-d '{"message": "What pages are available?"}' | python3 -m json.tool
	@echo ""
	@echo "Stopping test server..."
	@kill %1 2>/dev/null || true

# Smoke test with Keycloak auth (requires KEYCLOAK_JWKS_URL and a valid token)
test-api-auth:
	@echo "Starting API server for testing..."
	@uv run shift-agent api --port 5199 &
	@sleep 3
	@echo "--- Health check ---"
	@curl -s http://localhost:5199/api/v1/health | python3 -m json.tool
	@echo ""
	@echo "--- Chat request without token (should fail) ---"
	@curl -s -X POST http://localhost:5199/api/v1/chat -H "Content-Type: application/json" \
		-d '{"message": "hello"}' | python3 -m json.tool
	@echo ""
	@echo "Stopping test server..."
	@kill %1 2>/dev/null || true

# Clean build artifacts and virtual environment
clean:
	rm -rf .venv dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Show available commands
help:
	@echo "Shift Agent - Available commands:"
	@echo ""
	@echo "  make install     Install uv and sync dependencies"
	@echo "  make sync        Re-sync dependencies after pyproject.toml changes"
	@echo "  make chat        Interactive terminal chat with the agent"
	@echo "  make api         Start REST API server (0.0.0.0:8899)"
	@echo "  make api-custom  Start REST API on 127.0.0.1:8080"
	@echo "  make api-debug   Start REST API in debug mode"
	@echo "  make mcp         Start MCP server (stdio transport)"
	@echo "  make mcp-http    Start MCP server (streamable HTTP, :8900)"
	@echo "  make mcp-token   Fetch an access token for the HTTP MCP server"
	@echo "  make knowledge   List the knowledge bundle (Q=\"...\" to search it)"
	@echo "  make test-api    Smoke test the REST API (no auth)"
	@echo "  make test-api-auth  Smoke test with Keycloak auth"
	@echo "  make clean       Remove .venv and build artifacts"
	@echo "  make help        Show this help"
