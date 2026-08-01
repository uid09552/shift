//! OpenTelemetry wiring: traces and metrics over OTLP, plus the `tracing`
//! subscriber the whole binary logs through.
//!
//! Everything here is inert unless an OTLP endpoint is configured (see
//! [`crate::config::OtelConfig`]): `init` still installs a console logger, but
//! no provider is registered, so the global tracer/meter stay no-ops and the
//! instrumentation below costs nothing.
//!
//! What is instrumented:
//!   - **API paths** — [`http_trace_layer`], an axum middleware that opens a
//!     server span per request named after the matched route (`GET
//!     /api/v1/employees/:employee_id`), continuing the caller's trace when it
//!     sends a `traceparent` header, and records the request-duration metric.
//!   - **Database calls** — a Diesel [`Instrumentation`] installed on every
//!     pooled connection, giving one client span (and one duration metric) per
//!     statement. Repositories run their queries through [`db_blocking`] so
//!     those spans land under the request span rather than at the root: Diesel
//!     runs blocking, so every query lives on a `spawn_blocking` thread, and
//!     that hop is where span context would otherwise be lost.
//!   - **Backend calls between services** — [`current_traceparent`] and
//!     [`context_from_traceparent`] carry the trace across NATS to the Python
//!     planner and back, which HTTP headers can't do for us.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};
use opentelemetry::{
    global,
    metrics::{Counter, Histogram},
    propagation::{Extractor, Injector},
    trace::TracerProvider as _,
    Context, KeyValue,
};
use opentelemetry_otlp::{
    tonic_types::metadata::MetadataMap, Protocol, WithExportConfig, WithHttpConfig, WithTonicConfig,
};
use opentelemetry_sdk::{
    metrics::{PeriodicReader, SdkMeterProvider},
    propagation::TraceContextPropagator,
    trace::{Sampler, SdkTracerProvider},
    Resource,
};
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, Layer};

use crate::config::OtelConfig;

/// Instrumentation scope name for everything this binary emits.
const SCOPE: &str = "shift-backend";

// ── Startup / shutdown ───────────────────────────────────────────────────────

/// Live providers, kept so they can be flushed on shutdown. Dropping this
/// without calling [`Telemetry::shutdown`] loses whatever is still batched.
pub struct Telemetry {
    tracer_provider: Option<SdkTracerProvider>,
    meter_provider: Option<SdkMeterProvider>,
}

impl Telemetry {
    /// Whether spans and metrics are actually being exported.
    pub fn enabled(&self) -> bool {
        self.tracer_provider.is_some()
    }

    /// Flush everything still batched. Call before the process exits.
    pub fn shutdown(self) {
        if let Some(provider) = self.tracer_provider {
            if let Err(e) = provider.shutdown() {
                eprintln!("OTel tracer shutdown failed: {e}");
            }
        }
        if let Some(provider) = self.meter_provider {
            if let Err(e) = provider.shutdown() {
                eprintln!("OTel meter shutdown failed: {e}");
            }
        }
    }
}

/// Install the `tracing` subscriber and, when an OTLP endpoint is configured,
/// the OpenTelemetry trace and metric pipelines.
///
/// Log level comes from `RUST_LOG`, falling back to `verbose`.
pub fn init(cfg: &OtelConfig, verbose: bool) -> Telemetry {
    let default_level = if verbose { "debug" } else { "info" };
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // Keep third-party crates quiet at debug level; they are noisy enough
        // to bury our own logs.
        EnvFilter::new(format!("{default_level},hyper=info,tonic=info,h2=info"))
    });
    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);

    if !cfg.enabled() {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt_layer)
            .init();
        return Telemetry {
            tracer_provider: None,
            meter_provider: None,
        };
    }

    let resource = build_resource(cfg);

    let (tracer_provider, meter_provider) = match build_providers(cfg, resource) {
        Ok(providers) => providers,
        Err(e) => {
            // A broken exporter config must not stop the server from serving.
            tracing_subscriber::registry()
                .with(filter)
                .with(fmt_layer)
                .init();
            tracing::error!("OpenTelemetry disabled — exporter setup failed: {e}");
            return Telemetry {
                tracer_provider: None,
                meter_provider: None,
            };
        }
    };

    let tracer = tracer_provider.tracer(SCOPE);
    global::set_tracer_provider(tracer_provider.clone());
    global::set_meter_provider(meter_provider.clone());
    // W3C trace context: what we read off incoming requests and write onto
    // outgoing ones.
    global::set_text_map_propagator(TraceContextPropagator::new());

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .with(
            tracing_opentelemetry::layer()
                .with_tracer(tracer)
                // busy_ns/idle_ns on every span is noise here — span duration
                // already says what these traces are read for.
                .with_tracked_inactivity(false)
                .boxed(),
        )
        .init();

    // Bind the instruments now that the real meter provider is in place —
    // instruments created before this would stay attached to the no-op meter.
    let _ = metrics();

    // One span per SQL statement, on every connection the pool opens.
    if let Err(e) = diesel::connection::set_default_instrumentation(db_instrumentation) {
        tracing::warn!("Could not install database instrumentation: {e}");
    }

    tracing::info!(
        endpoint = %cfg.endpoint,
        protocol = %cfg.protocol,
        service.name = %cfg.service_name,
        "OpenTelemetry enabled"
    );

    Telemetry {
        tracer_provider: Some(tracer_provider),
        meter_provider: Some(meter_provider),
    }
}

fn build_resource(cfg: &OtelConfig) -> Resource {
    let mut attributes = vec![];
    if !cfg.service_version.is_empty() {
        attributes.push(KeyValue::new("service.version", cfg.service_version.clone()));
    }
    if !cfg.environment.is_empty() {
        attributes.push(KeyValue::new(
            "deployment.environment.name",
            cfg.environment.clone(),
        ));
    }
    // GitLab's vendor namespace — links telemetry back to the project, and is
    // what GitLab Duo needs to correlate traces with commits and issues.
    if !cfg.gitlab_project_id.is_empty() {
        attributes.push(KeyValue::new(
            "gitlab.project.id",
            cfg.gitlab_project_id.clone(),
        ));
    }
    if !cfg.gitlab_project_name.is_empty() {
        attributes.push(KeyValue::new(
            "gitlab.project.name",
            cfg.gitlab_project_name.clone(),
        ));
    }

    Resource::builder()
        .with_service_name(cfg.service_name.clone())
        .with_attributes(attributes)
        .build()
}

/// Build the span and metric exporters for the configured protocol.
///
/// gRPC takes the endpoint as-is; OTLP/HTTP needs the per-signal path appended
/// (`/v1/traces`, `/v1/metrics`) because an explicitly configured endpoint is
/// used verbatim by the exporter.
fn build_providers(
    cfg: &OtelConfig,
    resource: Resource,
) -> Result<(SdkTracerProvider, SdkMeterProvider), Box<dyn std::error::Error>> {
    let endpoint = cfg.endpoint.trim().trim_end_matches('/').to_string();
    let headers = parse_headers(&cfg.headers);
    let grpc = matches!(cfg.protocol.trim().to_ascii_lowercase().as_str(), "grpc");

    let (span_exporter, metric_exporter) = if grpc {
        let metadata = grpc_metadata(&headers);
        (
            opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(&endpoint)
                .with_metadata(metadata.clone())
                .with_timeout(Duration::from_secs(10))
                .build()?,
            opentelemetry_otlp::MetricExporter::builder()
                .with_tonic()
                .with_endpoint(&endpoint)
                .with_metadata(metadata)
                .with_timeout(Duration::from_secs(10))
                .build()?,
        )
    } else {
        (
            opentelemetry_otlp::SpanExporter::builder()
                .with_http()
                .with_protocol(Protocol::HttpBinary)
                .with_endpoint(signal_endpoint(&endpoint, "/v1/traces"))
                .with_headers(headers.clone())
                .with_timeout(Duration::from_secs(10))
                .build()?,
            opentelemetry_otlp::MetricExporter::builder()
                .with_http()
                .with_protocol(Protocol::HttpBinary)
                .with_endpoint(signal_endpoint(&endpoint, "/v1/metrics"))
                .with_headers(headers)
                .with_timeout(Duration::from_secs(10))
                .build()?,
        )
    };

    let tracer_provider = SdkTracerProvider::builder()
        .with_batch_exporter(span_exporter)
        // Respect an upstream service's sampling decision; sample our own root
        // spans at the configured ratio.
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
            cfg.sample_ratio.clamp(0.0, 1.0),
        ))))
        .with_resource(resource.clone())
        .build();

    let meter_provider = SdkMeterProvider::builder()
        .with_reader(
            PeriodicReader::builder(metric_exporter)
                .with_interval(Duration::from_secs(30))
                .build(),
        )
        .with_resource(resource)
        .build();

    Ok((tracer_provider, meter_provider))
}

/// Append the OTLP/HTTP signal path unless the endpoint already carries one.
fn signal_endpoint(endpoint: &str, path: &str) -> String {
    if endpoint.ends_with(path) {
        endpoint.to_string()
    } else {
        format!("{endpoint}{path}")
    }
}

/// gRPC carries the export headers as call metadata rather than as HTTP
/// headers; malformed pairs are dropped rather than failing startup.
fn grpc_metadata(headers: &HashMap<String, String>) -> MetadataMap {
    let mut map = axum::http::HeaderMap::new();
    for (key, value) in headers {
        if let (Ok(name), Ok(value)) = (
            axum::http::HeaderName::from_bytes(key.as_bytes()),
            axum::http::HeaderValue::from_str(value),
        ) {
            map.insert(name, value);
        } else {
            tracing::warn!("Ignoring malformed OTLP export header '{key}'");
        }
    }
    MetadataMap::from_headers(map)
}

/// Parse `OTEL_EXPORTER_OTLP_HEADERS` syntax: `key=value,key2=value2`.
fn parse_headers(raw: &str) -> HashMap<String, String> {
    raw.split(',')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            let key = key.trim();
            if key.is_empty() {
                return None;
            }
            Some((key.to_string(), value.trim().to_string()))
        })
        .collect()
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/// The instruments this service records on. Bound once, on first use.
pub struct Metrics {
    /// Server-side request latency, by route and status.
    pub http_server_duration: Histogram<f64>,
    /// Per-statement database latency, by operation and table.
    pub db_client_duration: Histogram<f64>,
    /// Messages we put on NATS.
    pub messaging_published: Counter<u64>,
    /// Messages we took off NATS.
    pub messaging_consumed: Counter<u64>,
}

static METRICS: std::sync::OnceLock<Metrics> = std::sync::OnceLock::new();

/// The global instruments. Cheap no-ops until [`init`] registers a provider.
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| {
        let meter = global::meter(SCOPE);
        Metrics {
            http_server_duration: meter
                .f64_histogram("http.server.request.duration")
                .with_description("Duration of inbound HTTP requests")
                .with_unit("s")
                .build(),
            db_client_duration: meter
                .f64_histogram("db.client.operation.duration")
                .with_description("Duration of database statements")
                .with_unit("s")
                .build(),
            messaging_published: meter
                .u64_counter("messaging.client.published.messages")
                .with_description("Messages published to the broker")
                .build(),
            messaging_consumed: meter
                .u64_counter("messaging.client.consumed.messages")
                .with_description("Messages consumed from the broker")
                .build(),
        }
    })
}

// ── HTTP server instrumentation ──────────────────────────────────────────────

/// axum middleware: one server span and one duration measurement per request.
///
/// The span is named after the *matched route* rather than the raw path, so
/// `/api/v1/employees/<uuid>` groups under `/api/v1/employees/:employee_id`
/// instead of exploding into one name per employee.
pub async fn http_trace_layer(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let path = req.uri().path().to_string();
    let query = req.uri().query().map(|q| q.to_string());

    // Continue the caller's trace if it sent one (the agent and MCP server do).
    let parent = global::get_text_map_propagator(|propagator| {
        propagator.extract(&HeaderExtractor(req.headers()))
    });

    let span = tracing::info_span!(
        "http.server.request",
        otel.name = %format!("{method} {route}"),
        otel.kind = "server",
        otel.status_code = tracing::field::Empty,
        http.request.method = %method,
        http.route = %route,
        url.path = %path,
        url.query = tracing::field::Empty,
        http.response.status_code = tracing::field::Empty,
    );
    if let Some(query) = query {
        span.record("url.query", query.as_str());
    }
    // Errors here only mean the OTel layer isn't installed — i.e. telemetry is off.
    let _ = span.set_parent(parent);

    let start = Instant::now();
    let response = {
        use tracing::Instrument;
        next.run(req).instrument(span.clone()).await
    };
    let elapsed = start.elapsed().as_secs_f64();
    let status = response.status();

    // As i64: semconv types the status code as an integer, and an unsigned
    // tracing value would be exported as a string.
    span.record("http.response.status_code", status.as_u16() as i64);
    // Only server errors mark the span failed: a 4xx is the caller's problem,
    // and flagging it would drown real failures (semconv says the same).
    if status.is_server_error() {
        span.record("otel.status_code", "ERROR");
    }

    metrics().http_server_duration.record(
        elapsed,
        &[
            KeyValue::new("http.request.method", method.to_string()),
            KeyValue::new("http.route", route),
            KeyValue::new("http.response.status_code", status.as_u16() as i64),
        ],
    );

    response
}

/// Reads W3C headers off an incoming request.
struct HeaderExtractor<'a>(&'a axum::http::HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

// ── Cross-service context propagation (NATS) ─────────────────────────────────

/// Collects the propagator's output into a plain map.
#[derive(Default)]
struct MapInjector(HashMap<String, String>);

impl Injector for MapInjector {
    fn set(&mut self, key: &str, value: String) {
        self.0.insert(key.to_string(), value);
    }
}

/// Reads W3C fields back out of a message payload.
struct MapExtractor(HashMap<String, String>);

impl Extractor for MapExtractor {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(|v| v.as_str())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

/// The current span as a W3C `traceparent`, to be carried in a message
/// payload. `None` when nothing is being traced.
pub fn current_traceparent() -> Option<String> {
    let context = Span::current().context();
    let mut injector = MapInjector::default();
    global::get_text_map_propagator(|propagator| propagator.inject_context(&context, &mut injector));
    injector.0.remove("traceparent")
}

/// The trace context a message was published in, for use as a span parent:
/// `span.set_parent(context_from_traceparent(tp))`.
pub fn context_from_traceparent(traceparent: Option<&str>) -> Context {
    let mut carrier = MapExtractor(HashMap::new());
    if let Some(traceparent) = traceparent {
        carrier
            .0
            .insert("traceparent".to_string(), traceparent.to_string());
    }
    global::get_text_map_propagator(|propagator| propagator.extract(&carrier))
}

// ── Database instrumentation ─────────────────────────────────────────────────

/// Run a blocking database closure with the calling span still current.
///
/// `tokio::task::spawn_blocking` hands the closure to another thread, and the
/// current span — thread-local — does not follow. Without this, every query
/// span produced by [`db_instrumentation`] would start a trace of its own
/// instead of hanging under the request that caused it.
pub fn db_blocking<F, R>(f: F) -> tokio::task::JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    let span = Span::current();
    tokio::task::spawn_blocking(move || span.in_scope(f))
}

/// Constructor handed to Diesel; it calls this for each new connection.
fn db_instrumentation() -> Option<Box<dyn diesel::connection::Instrumentation>> {
    Some(Box::new(DbInstrumentation::default()))
}

#[derive(Default)]
struct DbInstrumentation {
    /// The span of the statement currently in flight. A connection runs one
    /// statement at a time, so a single slot is enough.
    in_flight: Option<(Span, Instant, String)>,
    connecting: Option<(Span, Instant)>,
}

impl diesel::connection::Instrumentation for DbInstrumentation {
    fn on_connection_event(&mut self, event: diesel::connection::InstrumentationEvent<'_>) {
        use diesel::connection::InstrumentationEvent as E;

        match event {
            // The URL carries the password, so none of it is recorded.
            E::StartEstablishConnection { .. } => {
                self.connecting = Some((
                    tracing::info_span!(
                        "db.connect",
                        otel.name = "postgresql connect",
                        otel.kind = "client",
                        otel.status_code = tracing::field::Empty,
                        db.system.name = "postgresql",
                    ),
                    Instant::now(),
                ));
            }
            E::FinishEstablishConnection { error, .. } => {
                if let Some((span, _start)) = self.connecting.take() {
                    if error.is_some() {
                        span.record("otel.status_code", "ERROR");
                    }
                }
            }
            E::StartQuery { query, .. } => {
                let statement = sanitize_query(&query.to_string());
                let operation = operation_of(&statement);
                self.in_flight = Some((
                    tracing::info_span!(
                        "db.query",
                        otel.name = %operation,
                        otel.kind = "client",
                        otel.status_code = tracing::field::Empty,
                        db.system.name = "postgresql",
                        db.operation.name = %operation,
                        db.query.text = %statement,
                        error.type = tracing::field::Empty,
                    ),
                    Instant::now(),
                    operation,
                ));
            }
            E::FinishQuery { error, .. } => {
                if let Some((span, start, operation)) = self.in_flight.take() {
                    if let Some(error) = error {
                        span.record("otel.status_code", "ERROR");
                        span.record("error.type", tracing::field::display(error));
                    }
                    metrics().db_client_duration.record(
                        start.elapsed().as_secs_f64(),
                        &[
                            KeyValue::new("db.system.name", "postgresql"),
                            KeyValue::new("db.operation.name", operation),
                            KeyValue::new("error", error.is_some()),
                        ],
                    );
                }
            }
            _ => {}
        }
    }
}

/// Drop Diesel's bind-parameter suffix and cap the length: bound values are
/// real employee data, and `db.query.text` is meant to be the statement alone.
fn sanitize_query(query: &str) -> String {
    let statement = query
        .split(" -- binds:")
        .next()
        .unwrap_or(query)
        .trim()
        .replace('\n', " ");
    if statement.len() > 1024 {
        format!("{}…", &statement[..1024])
    } else {
        statement
    }
}

/// A short span name for a statement: the SQL verb plus the table it touches,
/// e.g. `SELECT employees` — the low-cardinality name semconv asks for.
fn operation_of(statement: &str) -> String {
    let mut words = statement.split_whitespace();
    let verb = words.next().unwrap_or("query").to_ascii_uppercase();
    let table = match verb.as_str() {
        "SELECT" | "DELETE" => word_after(&mut words, "from"),
        "INSERT" => word_after(&mut words, "into"),
        "UPDATE" => words.next(),
        _ => None,
    };

    // Diesel parenthesises joined sources — `FROM ("a" INNER JOIN "b" …)` —
    // so the first table comes wrapped in punctuation.
    match table {
        Some(table) => format!(
            "{verb} {}",
            table.trim_matches(|c| c == '(' || c == ')' || c == '"')
        ),
        None => verb,
    }
}

/// The word following `keyword`, e.g. the table name after `FROM`.
fn word_after<'a>(
    words: &mut impl Iterator<Item = &'a str>,
    keyword: &str,
) -> Option<&'a str> {
    words.find(|word| word.eq_ignore_ascii_case(keyword))?;
    words.next()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_binds_from_statements() {
        let query = "SELECT \"employees\".\"id\" FROM \"employees\" WHERE \"employees\".\"email\" = $1 -- binds: [\"a@b.c\"]";
        let statement = sanitize_query(query);
        assert!(!statement.contains("a@b.c"));
        assert!(statement.ends_with("= $1"));
    }

    #[test]
    fn names_operations_after_verb_and_table() {
        assert_eq!(
            operation_of("SELECT \"employees\".\"id\" FROM \"employees\" WHERE x = $1"),
            "SELECT employees"
        );
        assert_eq!(
            operation_of("INSERT INTO \"shifts\" (\"name\") VALUES ($1)"),
            "INSERT shifts"
        );
        assert_eq!(operation_of("UPDATE \"shifts\" SET \"name\" = $1"), "UPDATE shifts");
        assert_eq!(operation_of("BEGIN"), "BEGIN");
        assert_eq!(
            operation_of(
                "SELECT \"shifts\".\"id\" FROM (\"employee_available_shifts\" INNER JOIN \"shifts\" ON x)"
            ),
            "SELECT employee_available_shifts"
        );
    }

    #[test]
    fn carries_trace_context_through_a_message_payload() {
        const TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
        global::set_text_map_propagator(TraceContextPropagator::new());

        // What the planner does with the traceparent the backend sent…
        let context = context_from_traceparent(Some(TRACEPARENT));
        // …and what it sends back on the result, unchanged for the same span.
        let mut injector = MapInjector::default();
        global::get_text_map_propagator(|propagator| {
            propagator.inject_context(&context, &mut injector)
        });
        assert_eq!(injector.0.get("traceparent").map(String::as_str), Some(TRACEPARENT));

        // Nothing to propagate when no span is active (telemetry off).
        assert_eq!(current_traceparent(), None);
    }

    #[test]
    fn parses_exporter_headers() {
        let headers = parse_headers("private-token=abc , x-other=1");
        assert_eq!(headers.get("private-token"), Some(&"abc".to_string()));
        assert_eq!(headers.get("x-other"), Some(&"1".to_string()));
        assert!(parse_headers("").is_empty());
    }

    #[test]
    fn appends_signal_path_once() {
        assert_eq!(
            signal_endpoint("https://otel.example.com:14318", "/v1/traces"),
            "https://otel.example.com:14318/v1/traces"
        );
        assert_eq!(
            signal_endpoint("https://otel.example.com:14318/v1/traces", "/v1/traces"),
            "https://otel.example.com:14318/v1/traces"
        );
    }
}
