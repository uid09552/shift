"""
OpenTelemetry setup for the planner — traces and metrics over OTLP.

Everything here is a no-op unless an OTLP endpoint is configured, so the
service runs unchanged without a collector:

    OTEL_EXPORTER_OTLP_ENDPOINT   enables export; gRPC (default, port 14317)
                                  or HTTP (port 14318)
    OTEL_EXPORTER_OTLP_PROTOCOL   "grpc" (default) or "http/protobuf"
    OTEL_EXPORTER_OTLP_HEADERS    "key=value,key2=value2" (e.g. an auth token)
    OTEL_SERVICE_NAME             defaults to "shift-planner"

Resource attributes are filled from GitLab's CI variables when present
(CI_PROJECT_ID, CI_PROJECT_NAME, CI_COMMIT_SHA, CI_ENVIRONMENT_NAME) so
telemetry links back to the project and the exact commit.

What is instrumented:
  - the REST API's request paths, via ``instrument_flask``;
  - each NATS scheduling job, via ``consumer_span``, which continues the trace
    the backend started (the ``traceparent`` it puts in the payload — NATS
    carries no headers of its own);
  - each solver run, via ``record_solve``: a duration histogram and a counter
    broken down by result status.
"""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)

SERVICE_NAME = "shift-planner"
SCOPE = "shift-planner"

_enabled = False
_tracer: Any = None
_solve_duration: Any = None
_solve_total: Any = None


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

def endpoint() -> str:
    """The configured OTLP endpoint, or "" when telemetry is off."""
    return os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()


def enabled() -> bool:
    """Whether telemetry was successfully set up."""
    return _enabled


def _resource():
    from opentelemetry.sdk.resources import Resource

    attributes = {"service.name": os.environ.get("OTEL_SERVICE_NAME") or SERVICE_NAME}

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


def _use_grpc() -> bool:
    protocol = os.environ.get("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc").strip().lower()
    return protocol in ("", "grpc")


def _exporters():
    """The (span, metric) exporter pair for the configured protocol.

    Both read the endpoint, headers and TLS settings straight from the
    standard OTEL_* environment variables.
    """
    if _use_grpc():
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


def init_telemetry(service_name: str | None = None) -> bool:
    """Configure the trace and metric pipelines. Returns whether they are on.

    Safe to call more than once and safe to call with no collector
    configured; failures are logged and leave the process running without
    telemetry rather than stopping it from starting.
    """
    global _enabled, _tracer, _solve_duration, _solve_total

    if _enabled:
        return True
    if not endpoint():
        logger.info("OpenTelemetry disabled — OTEL_EXPORTER_OTLP_ENDPOINT is not set")
        return False
    if service_name:
        os.environ.setdefault("OTEL_SERVICE_NAME", service_name)

    # Emit the stable HTTP conventions (http.request.method, …) rather than the
    # superseded ones, matching what the Rust backend records. Read by the
    # instrumentation libraries when they are imported, so it has to be set
    # before instrument_flask below.
    os.environ.setdefault("OTEL_SEMCONV_STABILITY_OPT_IN", "http")

    try:
        from opentelemetry import metrics, trace
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        span_exporter, metric_exporter = _exporters()
        resource = _resource()

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
        _solve_duration = meter.create_histogram(
            "planner.solve.duration",
            unit="s",
            description="Wall-clock duration of a CP-SAT solve",
        )
        _solve_total = meter.create_counter(
            "planner.solve.total",
            description="Solver runs, by result status",
        )
        _enabled = True
        logger.info(
            "OpenTelemetry enabled — exporting to %s over %s",
            endpoint(),
            "grpc" if _use_grpc() else "http",
        )
    except Exception:
        logger.exception("OpenTelemetry setup failed — continuing without telemetry")
        return False

    return True


def instrument_flask(app) -> None:
    """Trace every request the REST API serves, named after its route."""
    if not _enabled:
        return
    try:
        from opentelemetry.instrumentation.flask import FlaskInstrumentor

        FlaskInstrumentor().instrument_app(app)
    except Exception:
        logger.exception("Flask instrumentation failed — requests will not be traced")


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
def consumer_span(name: str, traceparent: str | None, **attributes):
    """Span for one message taken off NATS, continuing the publisher's trace.

    ``traceparent`` is the W3C header value the backend puts in the payload —
    NATS gives us no header to carry it in. Without one this starts its own
    trace.
    """
    if not _enabled:
        yield None
        return

    from opentelemetry import trace
    from opentelemetry.trace import SpanKind

    context = None
    if traceparent:
        from opentelemetry.propagate import extract

        context = extract({"traceparent": traceparent})

    with _tracer.start_as_current_span(
        name,
        context=context,
        kind=SpanKind.CONSUMER,
        attributes={"messaging.system": "nats", **_clean(attributes)},
    ) as span:
        try:
            yield span
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
            raise


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


def current_traceparent() -> str | None:
    """The active span as a W3C ``traceparent``, to send back with a result."""
    if not _enabled:
        return None
    from opentelemetry.propagate import inject

    carrier: dict[str, str] = {}
    inject(carrier)
    return carrier.get("traceparent")


def set_attributes(span_obj, **attributes) -> None:
    """Add attributes to a span, tolerating the telemetry-off ``None`` span."""
    if span_obj is None:
        return
    for key, value in _clean(attributes).items():
        span_obj.set_attribute(key, value)


def record_solve(duration_seconds: float, status: str, **attributes) -> None:
    """Record one solver run against the duration histogram and counter."""
    if not _enabled:
        return
    tags = {"planner.status": status, **_clean(attributes)}
    _solve_duration.record(duration_seconds, tags)
    _solve_total.add(1, tags)


def _clean(attributes: dict) -> dict:
    """Drop unset attributes — OTel rejects None values."""
    return {k: v for k, v in attributes.items() if v is not None}
