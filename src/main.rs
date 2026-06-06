use clap::{Parser, Subcommand};
use shift::{broker, config::{self, CliArgs}, database, repository::AppState, server};
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
            };

            let config = config::Config::from_env_and_args(&cli_args)
                .expect("Failed to load configuration");

            println!("Starting server...");
            println!("Listen: {}:{}", config.server.listen, config.server.port);
            println!("Verbose: {}", config.server.verbose);
            println!("Database: {}", mask_postgres_url(&config.database.url).unwrap_or_else(|_| "Failed to mask URL".into()));
            println!("Broker: {}:{}", config.broker.host, config.broker.port);
            println!("Optimizer: {}", config.optimizer.url);

            // Initialize database
            let pool = database::establish_connection_pool(&config.database);
            database::run_migrations(&pool)?;

            // Connect to NATS broker
            let broker_conn = broker::connect(&config.broker).await?;

            // Start server
            let state = AppState::with_nats(Arc::new(pool), broker_conn.client, broker_conn.jetstream_status, config.optimizer.url.clone());
            let addr = format!("{}:{}", config.server.listen, config.server.port).parse::<SocketAddr>()?;
            server::start_server(state, addr).await?;
        }
    }

    Ok(())
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