#!/usr/bin/env python3
"""
Shift Agent CLI - run the agent interactively in the terminal, or start the
HTTP API server that the website talks to.

Usage:
    shift-agent chat
    shift-agent api --host 0.0.0.0 --port 8899
    shift-agent validate <optimizer-result-id>
    shift-agent fix <optimizer-result-id> --instruction "..."
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys

import click

from shift_agent import telemetry

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

    telemetry.init_telemetry("shift-agent-cli")

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

    try:
        asyncio.run(run())
    finally:
        telemetry.shutdown()


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

    # Before create_app: the Flask app is instrumented as it is built.
    telemetry.init_telemetry("shift-agent")

    print("Starting Shift Agent REST API")
    print(f"  Host      : {host}")
    print(f"  Port      : {port}")
    print(f"  Debug     : {debug}")
    print(f"  Knowledge : {knowledge_path or settings.knowledge_path}")
    print(f"  Telemetry : {telemetry.endpoint() or 'disabled'}")
    print()
    print("Endpoints:")
    print(f"  POST http://{host}:{port}/api/v1/chat")
    print(f"  POST http://{host}:{port}/api/v1/chat/upload")
    print(f"  POST http://{host}:{port}/api/v1/plan/validate")
    print(f"  POST http://{host}:{port}/api/v1/plan/fix")
    print(f"  GET  http://{host}:{port}/api/v1/health")
    print()

    app = create_app(knowledge_path=knowledge_path)
    try:
        app.run(host=host, port=port, debug=debug)
    finally:
        telemetry.shutdown()


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
@click.argument("result_id")
@click.option("--instruction", "-i", default="", help="What you want done, in your own words.")
@click.option(
    "--strategy",
    type=click.Choice(["repair", "resolve"]),
    default="repair",
    help="repair: move people around locally (seconds). resolve: re-run the optimizer (minutes).",
)
@click.option("--dry-run", is_flag=True, default=False, help="Report what would change without saving it.")
@click.option("--json", "as_json", is_flag=True, default=False, help="Print the raw report instead of a summary.")
@click.option("--explain/--no-explain", default=True, help="Have the LLM write the result up (default: on).")
def fix(result_id, instruction, strategy, dry_run, as_json, explain):
    """Fix a proposed shift plan (RESULT_ID) and save the result.

    The same thing the scheduler page's "Fix" button runs. Every row that
    breaks a hard rule is moved somewhere legal or removed, and short-staffed
    shifts are filled from whoever is free and qualified; --instruction carries
    your own wishes ("take Anna off the 12th") and is read by the LLM.
    """
    from shift_agent.agent import repair as repair_module
    from shift_agent.agent.client import MCPClient
    from shift_agent.agent.graph import plain_llm

    client = MCPClient()
    llm = plain_llm() if (instruction or explain) else None
    try:
        report = repair_module.fix(
            client.call_sync,
            result_id,
            instruction=instruction,
            strategy=strategy,
            llm=llm,
            persist=not dry_run,
        )
    except (validation_error_types()) as exc:
        raise click.ClickException(str(exc))

    if explain:
        report["summary"] = repair_module.narrate(report, llm)

    if as_json:
        click.echo(json.dumps(report, indent=2, default=str))
        return

    click.echo(f"\n{report['headline']}")
    if report.get("understood"):
        click.echo(f"Read as: {report['understood']}")
    for change in report.get("changes") or []:
        click.echo(f"  · {change['text']}")
    for rejected in report.get("rejected") or []:
        click.echo(f"  ✗ {rejected}")
    if report.get("optimizer_note"):
        click.echo(f"\nOptimizer: {report['optimizer_note']}")
    after = report["after"]
    click.echo(f"\nNow: {after['verdict'].upper()} — {after['error_count']} error(s), "
               f"{after['warning_count']} warning(s)")
    for finding in after["findings"]:
        click.echo(f"  [{finding['severity']}] {finding['rule']} ×{finding['count']} — {finding['title']}")
    if report.get("summary"):
        click.echo(f"\n{report['summary']}")
    if dry_run:
        click.echo("\n(dry run — nothing was saved)")


def validation_error_types():
    """The two failures `fix` reports as a clean message rather than a traceback."""
    from shift_agent.agent import repair as repair_module
    from shift_agent.agent import validation as validation_module

    return (validation_module.ValidationError, repair_module.RepairError)


@cli.command()
@click.argument("result_id")
@click.option("--json", "as_json", is_flag=True, default=False, help="Print the raw report instead of a summary.")
@click.option("--explain/--no-explain", default=True, help="Have the LLM write up the findings (default: on).")
def validate(result_id, as_json, explain):
    """Check a proposed shift plan (RESULT_ID) against the ward's rules.

    The same check the scheduler page's "Verify Plan" button runs — useful for
    inspecting a plan without a browser, or for seeing what the agent would
    report. Needs the MCP server reachable (MCP_SERVER_URL) and a token to
    reach the backend with (BACKEND_ACCESS_TOKEN).
    """
    from shift_agent.agent import validation
    from shift_agent.agent.client import MCPClient

    client = MCPClient()
    try:
        rules, result, capability_names = validation.collect(client.call_sync, result_id)
    except validation.ValidationError as exc:
        raise click.ClickException(str(exc))

    report = validation.validate(rules, result, capability_names)
    report["result_id"] = result_id
    report["headline"] = validation.headline(report)

    if explain:
        from shift_agent.agent.graph import build_llm

        try:
            report["summary"] = validation.narrate(report, build_llm())
        except Exception as exc:
            logger.warning("No LLM for the write-up: %s", exc)

    if as_json:
        click.echo(json.dumps(report, indent=2, default=str))
        return

    click.echo(f"\n{report['verdict'].upper()}: {report['headline']}")
    for finding in report["findings"]:
        click.echo(f"\n[{finding['severity']}] {finding['rule']} ×{finding['count']} — {finding['title']}")
        for example in finding["examples"]:
            click.echo(f"    · {example}")
        if finding.get("more"):
            click.echo(f"    … and {finding['more']} more")
    if report.get("summary"):
        click.echo(f"\n{report['summary']}")


@cli.command()
@click.option("--transport", default="stdio", type=click.Choice(["stdio", "http", "sse"]), help="MCP transport (default: stdio)")
@click.option("--host", default="0.0.0.0", help="Host to bind to for http/sse transports (default: 0.0.0.0)")
@click.option("--port", default=8900, type=int, help="Port to listen on for http/sse transports (default: 8900)")
def mcp(transport, host, port):
    """Start the MCP server generated from the backend's OpenAPI spec."""
    from shift_agent.mcp.server import get_mcp

    # Before get_mcp(): the server picks up its tracing middleware at build
    # time, and the backend httpx client is instrumented as it is created.
    telemetry.init_telemetry("shift-mcp")

    mcp_app = get_mcp()
    try:
        if transport == "stdio":
            # No HTTP layer here, so no ASGI middleware and nothing to continue
            # a trace from: a stdio client sends no traceparent.
            mcp_app.run(transport="stdio")
        else:
            mcp_app.run(
                transport=transport,
                host=host,
                port=port,
                middleware=telemetry.asgi_middleware(),
            )
    finally:
        telemetry.shutdown()


def main():
    """CLI entry point."""
    try:
        cli()
    except Exception as e:
        logger.error("Fatal error: %s", e, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
