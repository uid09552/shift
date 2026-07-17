"""
Shift Agent configuration, sourced from environment variables (see .env.example).
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # ChatAnthropic reads ANTHROPIC_API_KEY from the environment automatically —
    # nothing to wire up here beyond making sure .env is loaded (above).
    model: str = os.environ.get("SHIFT_AGENT_MODEL", "claude-opus-4-8")
    max_tokens: int = int(os.environ.get("SHIFT_AGENT_MAX_TOKENS", "4096"))

    backend_api_url: str = os.environ.get("BACKEND_API_URL", "http://localhost/api/v1")
    # Forwarded as x-access-token on every backend call. Unset when the backend
    # runs with --dev-mode. See README "Multi-tenant auth" for the production story.
    backend_access_token: str | None = os.environ.get("BACKEND_ACCESS_TOKEN") or None


settings = Settings()
