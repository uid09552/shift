"""
The chat model, for both processes that need one: the chat agent (its ReAct
loop and the plan narration) and the MCP server, whose repair tool reads a
planner's free-text instruction. Provider selection comes from configuration
(Ollama local, Ollama.com cloud, OpenAI).
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from shift_agent.config import settings

logger = logging.getLogger(__name__)


def build_llm() -> BaseChatModel:
    """Build the chat model based on the configured provider."""
    provider = settings.llm_provider

    if provider == "ollama":
        logger.info(
            "Using Ollama (local): %s, model=%s",
            settings.ollama_base_url,
            settings.model,
        )
        return ChatOpenAI(
            model=settings.model,
            base_url=f"{settings.ollama_base_url}/v1",
            api_key="ollama",
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    elif provider == "ollama-com":
        api_key = settings.ollama_com_api_key
        if not api_key:
            raise ValueError(
                "OLLAMA_COM_API_KEY is required when SHIFT_AGENT_LLM_PROVIDER=ollama-com"
            )
        logger.info("Using Ollama.com cloud: model=%s", settings.model)
        return ChatOpenAI(
            model=settings.model,
            base_url=f"{settings.ollama_com_base_url}/v1",
            api_key=api_key,
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    elif provider == "openai":
        logger.info("Using OpenAI: model=%s", settings.model)
        return ChatOpenAI(
            model=settings.model,
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
        )

    else:
        raise ValueError(
            f"Unknown LLM provider '{provider}'. "
            f"Expected one of: ollama, ollama-com, openai"
        )


# A second model instance with no tools bound and no conversation, for the
# small translation jobs inside the agent's own tools (reading the user's
# repair instruction). Built on first use and kept; False records that the
# provider is unreachable, so the attempt isn't repeated per call.
_plain_llm: Any = None


def plain_llm() -> BaseChatModel | None:
    """The tool-free model, or None when no provider is configured/reachable."""
    global _plain_llm
    if _plain_llm is None:
        try:
            _plain_llm = build_llm()
        except Exception:
            logger.exception("No LLM available for in-tool language work")
            _plain_llm = False
    return _plain_llm or None
