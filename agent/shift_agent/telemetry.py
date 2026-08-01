"""
OpenTelemetry setup for the agent and the MCP server — traces and metrics
over OTLP.

Everything here is a no-op unless an OTLP endpoint is configured, so both
processes run unchanged without a collector:

    OTEL_EXPORTER_OTLP_ENDPOINT   enables export; gRPC (default, port 14317)
                                  or HTTP (port 14318)
    OTEL_EXPORTER_OTLP_PROTOCOL   "grpc" (default) or "http/protobuf"
    OTEL_EXPORTER_OTLP_HEADERS    "key=value,key2=value2" (e.g. an auth token)
    OTEL_SERVICE_NAME             per process — "shift-agent" / "shift-mcp"

Resource attributes are filled from GitLab's CI variables when present
(CI_PROJECT_ID, CI_PROJECT_NAME, CI_COMMIT_SHA, CI_ENVIRONMENT_NAME) so
telemetry links back to the project and the exact commit.

What is instrumented, and why it hangs together:

    browser → agent /api/v1/chat   Flask instrumentation (``instrument_flask``)
    agent   → LLM                  httpx instrumentation — langchain's OpenAI
                                   client is an httpx client
    agent   → MCP server           httpx again, plus an explicit tool span
                                   (``tool_span``) around each call
    MCP     → backend REST API     httpx again

httpx instrumentation puts a ``traceparent`` header on every one of those
calls and the Rust backend reads it, so a chat message, the tool calls it
triggers and the SQL the backend runs all end up in one trace.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

SCOPE = "shift-agent"

_enabled = False
_tracer: Any = None
_chat_duration: Any = None
_chat_total: Any = None
_tool_duration: Any = None
_tool_total: Any = None


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

def endpoint() -> str:
    """The configured OTLP endpoint, or "" when telemetry is off."""
    return os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()


def enabled() -> bool:
    """Whether telemetry was successfully set up."""
    return _enabled


def _resource(service_name: str):
    from opentelemetry.sdk.resources import Resource

    attributes = {"service.name": os.environ.get("OTEL_SERVICE_NAME") or service_name}

    # GitLab's recommended attributes — service.version and
    # deployment.environment.name are OTel semconv, gitlab.* is their vendor
    # namespace (gitlab.project.id is what GitLab Duo needs).
    optional = {
        "service.version": os.environ.get("CI_COMMIT_SHA"),
        "deployment.environment.name": os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT")
        or os.environ.get("CI_ENVIRONMENT_NAME"),
        "gitlab.project.id": os.environ.get("CI_PROJECT_ID"),
        "gitlab.project.name": os.environ.get("CI_PROJECT_NAME"),
    }
    attributes.update({k: v for k, v in optional.items() if v})

    return Resource.create(attributes)


def _exporters():
    """The (span, metric) exporter pair for the configured protocol.

    Both read the endpoint, headers and TLS settings straight from the
    standard OTEL_* environment variables.
    """
    protocol = os.environ.get("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc").strip().lower()
    if protocol in ("", "grpc"):
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
    else:
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

    return OTLPSpanExporter(), OTLPMetricExporter()


def init_telemetry(service_name: str = "shift-agent") -> bool:
    """Configure the trace and metric pipelines. Returns whether they are on.

    Safe to call more than once and safe to call with no collector
    configured; failures are logged and leave the process running without
    telemetry rather than stopping it from starting.
    """
    global _enabled, _tracer
    global _chat_duration, _chat_total, _tool_duration, _tool_total

    if _enabled:
        return True
    if not endpoint():
        logger.info("OpenTelemetry disabled — OTEL_EXPORTER_OTLP_ENDPOINT is not set")
        return False

    # Emit the stable HTTP conventions (http.request.method, …) rather than the
    # superseded ones, matching what the Rust backend records. Read by the
    # instrumentation libraries when they are imported, so it has to be set
    # before instrument_flask / instrument_httpx below.
    os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http")

    try:
        from opentelemetry import metrics, trace
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        span_exporter, metric_exporter = _exporters()
        resource = _resource(service_name)

        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
        trace.set_tracer_provider(tracer_provider)

        metrics.set_meter_provider(
            MeterProvider(
                resource=resource,
                metric_readers=[
                    PeriodicExportingMetricReader(
                        metric_exporter, export_interval_millis=30_000
                    )
                ],
            )
        )

        _tracer = trace.get_tracer(SCOPE)
        meter = metrics.get_meter(SCOPE)
        _chat_duration = meter.create_histogram(
            "agent.chat.duration",
            unit="s",
            description="Time to answer one chat message, tool calls included",
        )
        _chat_total = meter.create_counter(
            "agent.chat.total", description="Chat messages handled, by outcome"
        )
        _tool_duration = meter.create_histogram(
            "agent.tool.duration",
            unit="s",
            description="Duration of one MCP tool call",
        )
        _tool_total = meter.create_counter(
            "agent.tool.total", description="MCP tool calls, by tool and outcome"
        )
        _enabled = True

        # Outgoing HTTP: the LLM API, the MCP server, and (in the MCP process)
        # the backend REST API. This is also what propagates trace context
        # onward as a traceparent header.
        instrument_httpx()

        logger.info(
            "OpenTelemetry enabled — exporting to %s as %s",
            endpoint(),
            os.environ.get("OTEL_SERVICE_NAME") or service_name,
        )
    except Exception:
        logger.exception("OpenTelemetry setup failed — continuing without telemetry")
        return False

    return True


def instrument_httpx() -> None:
    """Trace every outgoing httpx request, in any client this process makes."""
    if not _enabled:
        return
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
    except Exception:
        logger.exception("httpx instrumentation failed — outgoing calls untraced")


def instrument_flask(app) -> None:
    """Trace every request the chat API serves, named after its route."""
    if not _enabled:
        return
    try:
        from opentelemetry.instrumentation.flask import FlaskInstrumentor

        FlaskInstrumentor().instrument_app(app)
    except Exception:
        logger.exception("Flask instrumentation failed — requests will not be traced")


def asgi_middleware() -> list:
    """ASGI middleware for the MCP server's HTTP transport.

    Gives one server span per MCP HTTP request, continuing the trace of the
    caller that sent a ``traceparent`` (the chat agent does). Returned as a
    list so it can be splatted into FastMCP's ``middleware=`` argument, empty
    when telemetry is off.
    """
    if not _enabled:
        return []
    try:
        from fastmcp.server.http import Middleware
        from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

        return [Middleware(OpenTelemetryMiddleware)]
    except Exception:
        logger.exception("ASGI instrumentation failed — MCP requests untraced")
        return []


def shutdown() -> None:
    """Flush whatever is still batched. Call before the process exits."""
    if not _enabled:
        return
    try:
        from opentelemetry import metrics, trace

        tracer_provider = trace.get_tracer_provider()
        if hasattr(tracer_provider, "shutdown"):
            tracer_provider.shutdown()
        meter_provider = metrics.get_meter_provider()
        if hasattr(meter_provider, "shutdown"):
            meter_provider.shutdown()
    except Exception:
        logger.exception("OpenTelemetry shutdown failed")


# ---------------------------------------------------------------------------
# Spans
# ---------------------------------------------------------------------------

@contextmanager
def span(name: str, **attributes):
    """Plain internal span; a no-op when telemetry is off."""
    if not _enabled:
        yield None
        return

    from opentelemetry import trace

    with _tracer.start_as_current_span(name, attributes=_clean(attributes)) as sp:
        try:
            yield sp
        except Exception as exc:
            sp.record_exception(exc)
            sp.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
            raise


@contextmanager
def tool_span(tool_name: str, **attributes):
    """Span around one MCP tool call, as a client of the MCP server."""
    if not _enabled:
        yield None
        return

    from opentelemetry import trace
    from opentelemetry.trace import SpanKind

    with _tracer.start_as_current_span(
        f"mcp.call_tool {tool_name}",
        kind=SpanKind.CLIENT,
        attributes={"mcp.tool.name": tool_name, **_clean(attributes)},
    ) as sp:
        try:
            yield sp
        except Exception as exc:
            sp.record_exception(exc)
            sp.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
            raise


def current_context():
    """Snapshot of the active context, to carry across a thread hop.

    The MCP client runs its coroutines on a worker thread when it is called
    from inside a running event loop, and OTel context is per-thread — without
    this, those spans would start a trace of their own.
    """
    if not _enabled:
        return None
    from opentelemetry import context as otel_context

    return otel_context.get_current()


@contextmanager
def use_context(context):
    """Re-attach a context captured by :func:`current_context`."""
    if not _enabled or context is None:
        yield
        return

    from opentelemetry import context as otel_context

    token = otel_context.attach(context)
    try:
        yield
    finally:
        otel_context.detach(token)


def set_attributes(span_obj, **attributes) -> None:
    """Add attributes to a span, tolerating the telemetry-off ``None`` span."""
    if span_obj is None:
        return
    for key, value in _clean(attributes).items():
        span_obj.set_attribute(key, value)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def record_chat(duration_seconds: float, outcome: str, **attributes) -> None:
    """Record one handled chat message."""
    if not _enabled:
        return
    tags = {"agent.outcome": outcome, **_clean(attributes)}
    _chat_duration.record(duration_seconds, tags)
    _chat_total.add(1, tags)


def record_tool_call(duration_seconds: float, tool_name: str, outcome: str) -> None:
    """Record one MCP tool call."""
    if not _enabled:
        return
    tags = {"mcp.tool.name": tool_name, "agent.outcome": outcome}
    _tool_duration.record(duration_seconds, tags)
    _tool_total.add(1, tags)


def _clean(attributes: dict) -> dict:
    """Drop unset attributes — OTel rejects None values."""
    return {k: v for k, v in attributes.items() if v is not None}
