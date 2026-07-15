#!/usr/bin/env python3
"""
Shift Agent CLI - run the agent interactively in the terminal, or start the
HTTP API server that the website talks to.

Usage:
    shift-agent chat
    shift-agent api --host 0.0.0.0 --port 8899
"""

import logging
import sys

import click

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@click.group()
def cli():
    """Shift Agent CLI - LangGraph-based website assistant."""


@cli.command()
def chat():
    """Interactive terminal chat with the agent (for local testing)."""
    from langchain_core.messages import HumanMessage

    from shift_agent.graph import build_graph

    graph = build_graph()
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
            result = graph.invoke({"messages": [HumanMessage(content=text)]}, config=config)
        except Exception as e:
            logger.error("Agent invocation failed: %s", e)
            continue

        reply = result["messages"][-1].content
        print(f"agent> {reply}\n")


@cli.command()
@click.option("--host", default="0.0.0.0", help="Host to bind the server to (default: 0.0.0.0)")
@click.option("--port", default=8899, type=int, help="Port to listen on (default: 8899)")
@click.option("--debug", is_flag=True, default=False, help="Enable Flask debug mode")
def api(host, port, debug):
    """Start the agent's REST API server."""
    from shift_agent.server import create_app

    print("Starting Shift Agent REST API")
    print(f"  Host  : {host}")
    print(f"  Port  : {port}")
    print(f"  Debug : {debug}")
    print()
    print("Endpoints:")
    print(f"  POST http://{host}:{port}/api/v1/chat")
    print(f"  GET  http://{host}:{port}/api/v1/health")
    print()

    app = create_app()
    app.run(host=host, port=port, debug=debug)


def main():
    """CLI entry point."""
    try:
        cli()
    except Exception as e:
        logger.error("Fatal error: %s", e, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
