"""
Shift Agent configuration, sourced from environment variables (see .env.example).
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# shift_agent/config.py -> shift_agent -> agent -> backend/docs/knowledge.
# In deploy/Dockerfile.agent the same two levels up land on the image root,
# where the bundle is copied to /docs/knowledge (same trick as the OpenAPI
# spec in shift_agent/mcp/server.py).
_DEFAULT_KNOWLEDGE_PATH = Path(__file__).resolve().parents[2] / "docs" / "knowledge"


@dataclass(frozen=True)
class Settings:
    # ------------------------------------------------------------------
    # LLM provider
    # ------------------------------------------------------------------
    # One of: "ollama" (local), "ollama-com" (ollama.com cloud), "openai"
    llm_provider: str = os.environ.get("SHIFT_AGENT_LLM_PROVIDER", "ollama")

    # Model name — provider-specific:
    #   ollama:     e.g. "llama3.2", "qwen2.5", "mistral"
    #   ollama-com: e.g. "gpt-oss:20b", "gpt-oss:120b", "kimi-k2.6"
    #   openai:     e.g. "gpt-4o", "gpt-4o-mini"
    model: str = os.environ.get("SHIFT_AGENT_MODEL", "llama3.2")

    max_tokens: int = int(os.environ.get("SHIFT_AGENT_MAX_TOKENS", "4096"))
    temperature: float = float(os.environ.get("SHIFT_AGENT_TEMPERATURE", "0.1"))

    # ------------------------------------------------------------------
    # Ollama-specific
    # ------------------------------------------------------------------
    # Local Ollama server URL (used when llm_provider == "ollama")
    ollama_base_url: str = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

    # ollama.com cloud API key (used when llm_provider == "ollama-com")
    ollama_com_api_key: str | None = os.environ.get("OLLAMA_COM_API_KEY") or None
    # ollama.com API base URL (defaults to https://api.ollama.com)
    ollama_com_base_url: str = os.environ.get(
        "OLLAMA_COM_BASE_URL", "https://api.ollama.com"
    )

    # ------------------------------------------------------------------
    # OpenAI fallback (used when llm_provider == "openai")
    # ------------------------------------------------------------------
    # langchain-openai reads OPENAI_API_KEY from the environment automatically
    openai_api_key: str | None = os.environ.get("OPENAI_API_KEY") or None

    # ------------------------------------------------------------------
    # Backend API
    # ------------------------------------------------------------------
    backend_api_url: str = os.environ.get("BACKEND_API_URL", "http://localhost/api/v1")
    # Forwarded as x-access-token on every backend call. Unset when the backend
    # runs with --dev-mode. See README "Multi-tenant auth" for the production story.
    backend_access_token: str | None = os.environ.get("BACKEND_ACCESS_TOKEN") or None

    # ------------------------------------------------------------------
    # Keycloak / auth (for the chat REST API — server.py)
    # ------------------------------------------------------------------
    keycloak_realm_url: str = os.environ.get(
        "KEYCLOAK_REALM_URL", "http://localhost/auth/realms/shift"
    )
    # When set, the chat API (server.py) validates the incoming Authorization:
    # Bearer token against Keycloak's JWKS endpoint. Unset = no auth (dev mode).
    keycloak_jwks_url: str | None = os.environ.get("KEYCLOAK_JWKS_URL") or None

    # mcp_server.py's own incoming-client auth (MultiAuth: OIDCProxy + JWTVerifier).
    mcp_base_url: str = os.environ.get("MCP_BASE_URL", "http://localhost:8900")
    mcp_oauth_client_id: str | None = os.environ.get("MCP_OAUTH_CLIENT_ID") or None
    mcp_oauth_client_secret: str | None = os.environ.get("MCP_OAUTH_CLIENT_SECRET") or None

    # ------------------------------------------------------------------
    # MCP server the chat agent talks to (mcp_client.py)
    # ------------------------------------------------------------------
    # Streamable-HTTP endpoint of the MCP server. In deploy/docker-compose.yml
    # that's the "mcp" service; locally, http://localhost:8900/mcp.
    mcp_server_url: str = os.environ.get("MCP_SERVER_URL", "http://mcp:8900/mcp")
    mcp_timeout_seconds: float = float(os.environ.get("MCP_TIMEOUT_SECONDS", "30"))
    # Optional comma-separated allowlist of MCP tool names to bind to the LLM.
    # Unset = bind everything the server exposes — which for the OpenAPI-generated
    # server is the entire backend API, more than a small local model can handle.
    mcp_tools: tuple[str, ...] = tuple(
        name.strip() for name in os.environ.get("MCP_TOOLS", "").split(",") if name.strip()
    )

    # ------------------------------------------------------------------
    # Knowledge base (the agent's own tools — agent/knowledge.py)
    # ------------------------------------------------------------------
    # Root of the Open Knowledge Format bundle the agent answers product,
    # architecture and how-to questions from. Overridable at startup with
    # `shift-agent chat|api --knowledge-path`. A path that doesn't exist just
    # disables the knowledge tools; everything else still works.
    knowledge_path: str = os.environ.get(
        "SHIFT_AGENT_KNOWLEDGE_PATH", str(_DEFAULT_KNOWLEDGE_PATH)
    )


settings = Settings()
