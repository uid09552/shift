#!/usr/bin/env python3
"""
Shift Agent CLI - run the agent interactively in the terminal, or start the
HTTP API server that the website talks to.

Usage:
    shift-agent chat
    shift-agent api --host 0.0.0.0 --port 8899
"""

from __future__ import annotations

import asyncio
import logging
import sys

import click

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@click.group()
def cli():
    """Shift Agent CLI - LangGraph-based website assistant."""


@cli.command()
@click.option(
    "--knowledge-path",
    default=None,
    envvar="SHIFT_AGENT_KNOWLEDGE_PATH",
    help="Root of the Open Knowledge Format documentation bundle the agent "
    "answers product questions from (default: SHIFT_AGENT_KNOWLEDGE_PATH, "
    "else backend/docs/knowledge).",
)
def chat(knowledge_path):
    """Interactive terminal chat with the agent (for local testing)."""
    from langchain_core.messages import HumanMessage

    from shift_agent.agent.graph import build_graph, connect_mcp, disconnect_mcp

    async def run():
        state = build_graph(knowledge_path=knowledge_path)
        graph = await connect_mcp(state)

        config = {"configurable": {"thread_id": "cli"}}

        print("Shift Agent — type 'exit' to quit.\n")
        while True:
            try:
                text = input("you> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if text.lower() in {"exit", "quit"}:
                break
            if not text:
                continue

            try:
                result = await graph.ainvoke(
                    {"messages": [HumanMessage(content=text)]},
                    config=config,
                )
            except Exception as e:
                logger.error("Agent invocation failed: %s", e)
                continue

            reply = result["messages"][-1].content
            print(f"agent> {reply}\n")

        await disconnect_mcp(graph)

    asyncio.run(run())


@cli.command()
@click.option("--host", default="0.0.0.0", help="Host to bind the server to (default: 0.0.0.0)")
@click.option("--port", default=8899, type=int, help="Port to listen on (default: 8899)")
@click.option("--debug", is_flag=True, default=False, help="Enable Flask debug mode")
@click.option(
    "--knowledge-path",
    default=None,
    envvar="SHIFT_AGENT_KNOWLEDGE_PATH",
    help="Root of the Open Knowledge Format documentation bundle the agent "
    "answers product questions from (default: SHIFT_AGENT_KNOWLEDGE_PATH, "
    "else backend/docs/knowledge).",
)
def api(host, port, debug, knowledge_path):
    """Start the agent's REST API server."""
    from shift_agent.agent.server import create_app
    from shift_agent.config import settings

    print("Starting Shift Agent REST API")
    print(f"  Host      : {host}")
    print(f"  Port      : {port}")
    print(f"  Debug     : {debug}")
    print(f"  Knowledge : {knowledge_path or settings.knowledge_path}")
    print()
    print("Endpoints:")
    print(f"  POST http://{host}:{port}/api/v1/chat")
    print(f"  GET  http://{host}:{port}/api/v1/health")
    print()

    app = create_app(knowledge_path=knowledge_path)
    app.run(host=host, port=port, debug=debug)


@cli.command()
@click.argument("query", required=False)
@click.option(
    "--knowledge-path",
    default=None,
    envvar="SHIFT_AGENT_KNOWLEDGE_PATH",
    help="Root of the documentation bundle (default: SHIFT_AGENT_KNOWLEDGE_PATH, "
    "else backend/docs/knowledge).",
)
@click.option("--limit", default=5, type=int, help="Max results to show (default: 5)")
def knowledge(query, knowledge_path, limit):
    """Inspect the knowledge bundle the agent answers product questions from.

    Without QUERY, lists every document — the quickest way to check that a
    deployment resolved the bundle at all (e.g. inside the container:
    `docker compose exec agent shift-agent knowledge`). With QUERY, shows what
    the agent's searchKnowledge tool would find.
    """
    from shift_agent.agent.knowledge import KnowledgeBase
    from shift_agent.config import settings

    root = knowledge_path or settings.knowledge_path
    kb = KnowledgeBase(root)
    if not kb.available:
        raise click.ClickException(f"No knowledge documents found at {root}")

    if not query:
        for entry in kb.catalogue():
            click.echo(f"{entry['path']:45s} {entry['title']}")
        click.echo(f"\n{len(kb.docs)} document(s) in {kb.root}")
        return

    results = kb.search(query, limit=limit)
    if not results:
        click.echo(f"No documents matched '{query}'.")
        return
    for entry in results:
        click.echo(f"\n{entry['score']:>7}  {entry['path']} — {entry['title']}")
        click.echo(f"         {entry['snippet']}")


@cli.command()
@click.option("--transport", default="stdio", type=click.Choice(["stdio", "http", "sse"]), help="MCP transport (default: stdio)")
@click.option("--host", default="0.0.0.0", help="Host to bind to for http/sse transports (default: 0.0.0.0)")
@click.option("--port", default=8900, type=int, help="Port to listen on for http/sse transports (default: 8900)")
def mcp(transport, host, port):
    """Start the MCP server generated from the backend's OpenAPI spec."""
    from shift_agent.mcp.server import get_mcp

    mcp_app = get_mcp()
    if transport == "stdio":
        mcp_app.run(transport="stdio")
    else:
        mcp_app.run(transport=transport, host=host, port=port)


def main():
    """CLI entry point."""
    try:
        cli()
    except Exception as e:
        logger.error("Fatal error: %s", e, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
