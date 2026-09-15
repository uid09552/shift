use clap::{Parser, Subcommand};
use shift::{
    broker,
    config::{self, CliArgs, KeycloakConfig},
    database,
    repository::AppState,
    server,
    services::keycloak::{KeycloakAdmin, KeycloakSettings},
    telemetry,
};
use std::net::SocketAddr;
use std::sync::Arc;
use url::Url;

#[derive(Parser)]
#[command(name = "backend")]
#[command(about = "backend CLI start", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the server
    Serve {
        /// Port to listen on
        #[arg(long, default_value_t = 8080)]
        port: u16,

        /// Address to bind to
        #[arg(long, default_value = "127.0.0.1")]
        listen: String,

        /// Enable verbose logging
        #[arg(long, short, default_value_t = false)]
        verbose: bool,

        /// Database URL
        #[arg(long)]
        database_url: Option<String>,

        /// Database user
        #[arg(long)]
        database_user: Option<String>,

        /// Database password
        #[arg(long)]
        database_password: Option<String>,

        /// Database host
        #[arg(long)]
        database_host: Option<String>,

        /// Database port
        #[arg(long)]
        database_port: Option<u16>,

        /// Database name
        #[arg(long)]
        database_name: Option<String>,

        /// Broker host
        #[arg(long)]
        broker_host: Option<String>,

        /// Broker port
        #[arg(long)]
        broker_port: Option<u16>,

        /// Optimizer service URL
        #[arg(long)]
        optimizer_url: Option<String>,

        /// Run in dev mode: resolve the tenant from --tenant-id instead of an auth token
        #[arg(long, default_value_t = false)]
        dev_mode: bool,

        /// Default tenant id used in dev mode. Later this will come from the auth token.
        #[arg(long)]
        tenant_id: Option<String>,

        /// Keycloak base URL including its relative path, e.g. http://localhost:8080/auth.
        /// Unset means user management is unavailable.
        #[arg(long)]
        keycloak_url: Option<String>,

        /// Keycloak realm holding the users and organizations (default: shift)
        #[arg(long)]
        keycloak_realm: Option<String>,

        /// Confidential client whose service account manages users (default: shift-gateway)
        #[arg(long)]
        keycloak_client_id: Option<String>,

        /// Secret of that client
        #[arg(long)]
        keycloak_client_secret: Option<String>,

        /// OTLP endpoint to export traces and metrics to. Unset (and no
        /// OTEL_EXPORTER_OTLP_ENDPOINT) means no telemetry is exported.
        #[arg(long)]
        otel_endpoint: Option<String>,

        /// OTLP protocol: grpc (default) or http
        #[arg(long)]
        otel_protocol: Option<String>,

        /// service.name reported on exported telemetry (default: shift-backend)
        #[arg(long)]
        otel_service_name: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Serve {
            port,
            listen,
            verbose,
            database_url,
            database_user,
            database_password,
            database_host,
            database_port,
            database_name,
            broker_host,
            broker_port,
            optimizer_url,
            dev_mode,
            tenant_id,
            keycloak_url,
            keycloak_realm,
            keycloak_client_id,
            keycloak_client_secret,
            otel_endpoint,
            otel_protocol,
            otel_service_name,
        } => {
            let cli_args = CliArgs {
                port: Some(port),
                listen: Some(listen),
                verbose,
                database_url,
                database_user,
                database_password,
                database_host,
                database_port,
                database_name,
                broker_host,
                broker_port,
                optimizer_url,
                dev_mode,
                tenant_id,
                keycloak_url,
                keycloak_realm,
                keycloak_client_id,
                keycloak_client_secret,
                otel_endpoint,
                otel_protocol,
                otel_service_name,
            };

            let config = config::Config::from_env_and_args(&cli_args)
                .expect("Failed to load configuration");

            // Before anything else: logging goes through the tracing subscriber
            // this installs, and the database instrumentation it registers has
            // to be in place before the pool opens its first connection.
            let telemetry = telemetry::init(&config.otel, config.server.verbose);

            let build = shift::services::info::BuildInfo::init(&config.build);

            println!("Starting server...");
            println!(
                "Version: {}{}",
                build.version,
                if build.commit.is_empty() { String::new() } else { format!(" ({})", build.commit) }
            );
            println!("Listen: {}:{}", config.server.listen, config.server.port);
            println!("Verbose: {}", config.server.verbose);
            println!("Database: {}", mask_postgres_url(&config.database.url).unwrap_or_else(|_| "Failed to mask URL".into()));
            println!("Broker: {}:{}", config.broker.host, config.broker.port);
            println!("Optimizer: {}", config.optimizer.url);
            println!("Tenant: dev_mode={} tenant_id={}", config.tenant.dev_mode, config.tenant.tenant_id);
            println!(
                "Keycloak: {}",
                if keycloak_settings(&config.keycloak).is_some() {
                    format!("{} (realm {})", config.keycloak.url, config.keycloak.realm)
                } else {
                    "not configured — user management is unavailable".to_string()
                }
            );
            println!(
                "Telemetry: {}",
                if telemetry.enabled() {
                    format!("{} ({})", config.otel.endpoint, config.otel.protocol)
                } else {
                    "disabled (no OTLP endpoint configured)".to_string()
                }
            );

            // Initialize database
            let pool = database::establish_connection_pool(&config.database);
            database::run_migrations(&pool)?;

            // Connect to NATS broker
            let broker_conn = broker::connect(&config.broker).await?;

            // Start server
            let mut state = AppState::with_nats(Arc::new(pool), broker_conn.client, broker_conn.jetstream_status, config.optimizer.url.clone());
            state.dev_mode = config.tenant.dev_mode;
            state.default_tenant_id = config.tenant.tenant_id.clone();
            state.keycloak = keycloak_settings(&config.keycloak)
                .map(|settings| Arc::new(KeycloakAdmin::new(settings)));
            let addr = format!("{}:{}", config.server.listen, config.server.port).parse::<SocketAddr>()?;
            server::start_server(state, addr).await?;

            // Flush whatever is still batched before the process goes away.
            telemetry.shutdown();
        }
    }

    Ok(())
}

/// The Keycloak connection to use, or `None` when the deployment configures none.
/// User management is the only thing that needs it, so a missing configuration
/// disables that rather than stopping the server.
fn keycloak_settings(config: &KeycloakConfig) -> Option<KeycloakSettings> {
    let settings = KeycloakSettings {
        url: config.url.trim().to_string(),
        realm: config.realm.trim().to_string(),
        client_id: config.client_id.trim().to_string(),
        client_secret: config.client_secret.clone(),
    };
    KeycloakAdmin::is_configured(&settings).then_some(settings)
}

pub fn mask_postgres_url(input: &str) -> Result<String, url::ParseError> {
    let mut url = Url::parse(input)?;

    // Mask username if present
    if !url.username().is_empty() {
        url.set_username("****").ok();
    }

    // Mask password if present
    if url.password().is_some() {
        url.set_password(Some("****")).ok();
    }

    Ok(url.to_string())
}