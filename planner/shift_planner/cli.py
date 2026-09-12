#!/usr/bin/env python3
"""
Shift Planner CLI - Command-line interface for the scheduling solver.

Provides commands for running the scheduler once, starting the NATS
JetStream subscriber server (with the REST API alongside, unless --no-api),
or starting the Flask REST API server on its own.

Usage:
    shift-planner schedule [INPUT_FILE] [OUTPUT_FILE]
    shift-planner nats --queue-name scheduling --stream-name SCHEDULING --broker-url nats://localhost:4222 [--api-port 8888 | --no-api]
    shift-planner api --host 0.0.0.0 --port 8888
"""

import asyncio
import json
import logging
import sys
import threading

import click
from pydantic import ValidationError

from shift_planner import telemetry
from shift_planner.models import load_and_validate, validate_output, SchedulingOutput
from shift_planner.optimizer import solve

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

@click.group()
def cli():
    """Shift Planner CLI - schedule employees with CP-SAT solver."""
    pass


@cli.command()
@click.argument("input_file", default="input.json", required=False)
@click.argument("output_file", default="output.json", required=False)
def schedule(input_file, output_file):
    """Run scheduler once and output to file."""
    # Load and validate input
    try:
        validated_input = load_and_validate(input_file)
        data = validated_input.model_dump()
    except (ValidationError, ValueError) as e:
        logger.error(f"Input validation error: {e}")
        sys.exit(1)
    except FileNotFoundError:
        logger.error(f"Input file not found: {input_file}")
        sys.exit(1)

    result = solve(data)

    # Convert date objects to strings for JSON serialization
    for day_entry in result.get("schedule", []):
        if "date" in day_entry:
            day_entry["date"] = str(day_entry["date"])

    # Validate output against input constraints
    if result["status"] in ("optimal", "feasible"):
        violations = validate_output(result, validated_input)
        if violations:
            logger.warning("Output validation found %d violation(s):", len(violations))
            for v in violations:
                logger.warning("  - %s", v)
        else:
            logger.info("Output validation passed – no constraint violations")

    # Validate output model structure
    try:
        SchedulingOutput(**result)
        logger.info("Output model validation passed")
    except ValidationError as e:
        logger.error("Output model validation error: %s", e)

    with open(output_file, "w") as fh:
        json.dump(result, fh, indent=2)

    print(f"Schedule status : {result['status']}")
    if result["status"] in ("optimal", "feasible"):
        print(f"Objective value : {result['objective_value']:.0f}")
        print(f"Output written to: {output_file}")
        print()
        for emp in result["employee_summary"]:
            hours_str = f"{emp['total_working_hours']:.1f}h" if "total_working_hours" in emp else ""
            print(
                f"  {emp['employee_name']:>8s}: "
                f"{emp['total_shifts']} shifts "
                f"({emp['night_shifts']} night) "
                f"{hours_str} "
                f"days: {', '.join(emp['assigned_dates'])}"
            )
            if "per_shift" in emp:
                for ps in emp["per_shift"]:
                    print(
                        f"    {ps['shift_name']:>14s}: "
                        f"{ps['total_assignments']}×  "
                        f"days: {', '.join(ps['assigned_dates'])}"
                    )
    else:
        print(result["message"])


@cli.command()
@click.option(
    "--queue-name",
    default="scheduling",
    help="NATS subject to subscribe to (default: scheduling)",
)
@click.option(
    "--stream-name",
    default="SCHEDULING",
    help="NATS JetStream stream name (default: SCHEDULING)",
)
@click.option(
    "--broker-url",
    default="nats://localhost:4222",
    help="NATS broker URL (default: nats://localhost:4222)",
)
@click.option(
    "--api-host",
    default="0.0.0.0",
    help="Host to bind the REST API to (default: 0.0.0.0)",
)
@click.option(
    "--api-port",
    default=8888,
    type=int,
    help="Port for the REST API (default: 8888)",
)
@click.option(
    "--no-api",
    is_flag=True,
    default=False,
    help="Only subscribe to NATS, without the REST API",
)
def nats(queue_name, stream_name, broker_url, api_host, api_port, no_api):
    """Start scheduler server in NATS JetStream subscriber mode.

    The REST API (see `api`) runs alongside it unless --no-api is given: the
    backend plans through the queue, the agent's optimizeSchedule through
    POST /api/v1/optimize, and one process serves both.
    """
    from shift_planner.nats_handler import start_server

    telemetry.init_telemetry()

    print("Starting scheduler server (NATS)")
    print(f"  Broker URL : {broker_url}")
    print(f"  Stream name: {stream_name}")
    print(f"  Subject    : {queue_name}")
    print(f"  REST API   : {'disabled' if no_api else f'http://{api_host}:{api_port}/api/v1/optimize'}")
    print(f"  Telemetry  : {telemetry.endpoint() or 'disabled'}")
    print()

    http = None if no_api else _start_api_thread(api_host, api_port)
    try:
        asyncio.run(start_server(queue_name, broker_url, stream_name))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        # Exiting takes the API down with it, so the container restarts whole
        # rather than serving HTTP with the queue silently gone.
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        if http is not None:
            http.shutdown()
        telemetry.shutdown()


def _start_api_thread(host: str, port: int):
    """Serve the REST API from a background thread and return its server.

    The socket is bound here, on the calling thread, so a port already in use
    fails the start instead of dying unnoticed in the thread.
    """
    from werkzeug.serving import make_server

    from shift_planner.server import create_app

    http = make_server(host, port, create_app(), threaded=True)
    threading.Thread(target=http.serve_forever, name="rest-api", daemon=True).start()
    logger.info(f"REST API listening on http://{host}:{port}")
    return http


@cli.command()
@click.option(
    "--host",
    default="0.0.0.0",
    help="Host to bind the server to (default: 0.0.0.0)",
)
@click.option(
    "--port",
    default=8888,
    type=int,
    help="Port to listen on (default: 8888)",
)
@click.option(
    "--debug",
    is_flag=True,
    default=False,
    help="Enable Flask debug mode",
)
def api(host, port, debug):
    """Start scheduler server in REST API mode."""
    from shift_planner.server import create_app

    telemetry.init_telemetry()

    print("Starting Shift Planner REST API")
    print(f"  Host      : {host}")
    print(f"  Port      : {port}")
    print(f"  Debug     : {debug}")
    print(f"  Telemetry : {telemetry.endpoint() or 'disabled'}")
    print()
    print("Endpoints:")
    print(f"  POST http://{host}:{port}/api/v1/optimize  — Submit scheduling request")
    print(f"  GET  http://{host}:{port}/api/v1/health    — Health check")
    print()

    app = create_app()
    try:
        app.run(host=host, port=port, debug=debug)
    finally:
        telemetry.shutdown()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    """CLI entry point."""
    cli()


if __name__ == "__main__":
    main()
