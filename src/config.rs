use figment::{providers::{Env, Format, Serialized, Yaml}, Figment};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub listen: String,
    pub verbose: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,
    pub user: String,
    pub password: String,
    pub host: String,
    pub port: u16,
    pub database: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                port: 8080,
                listen: "127.0.0.1".to_string(),
                verbose: false,
            },
            database: DatabaseConfig {
                url: "postgresql://shift_user:shift_password@localhost:5432/shift".to_string(),
                user: "shift_user".to_string(),
                password: "shift_password".to_string(),
                host: "localhost".to_string(),
                port: 5432,
                database: "shift".to_string(),
            },
        }
    }
}

impl Config {
    pub fn from_env_and_args(args: &CliArgs) -> Result<Self, figment::Error> {
        let config_path = std::env::var("CONFIG_PATH").unwrap_or_else(|_| "config.yaml".to_string());
        let mut figment = Figment::new().merge(Serialized::defaults(Config::default()));

        if std::path::Path::new(&config_path).exists() {
            figment = figment.merge(Yaml::file(&config_path));
        }

        figment = figment
            .merge(Env::prefixed("SHIFT_"))
            .merge(Env::raw());

        // Override with CLI args if provided
        if let Some(port) = args.port {
            figment = figment.merge(("server.port", port));
        }
        if let Some(listen) = args.listen.clone() {
            figment = figment.merge(("server.listen", listen));
        }
        if args.verbose {
            figment = figment.merge(("server.verbose", true));
        }
        if let Some(db_url) = args.database_url.clone() {
            figment = figment.merge(("database.url", db_url));
        }
        if let Some(db_user) = args.database_user.clone() {
            figment = figment.merge(("database.user", db_user));
        }
        if let Some(db_password) = args.database_password.clone() {
            figment = figment.merge(("database.password", db_password));
        }
        if let Some(db_host) = args.database_host.clone() {
            figment = figment.merge(("database.host", db_host));
        }
        if let Some(db_port) = args.database_port {
            figment = figment.merge(("database.port", db_port));
        }
        if let Some(db_name) = args.database_name.clone() {
            figment = figment.merge(("database.database", db_name));
        }

        figment.extract()
    }
}

#[derive(Debug, Clone)]
pub struct CliArgs {
    pub port: Option<u16>,
    pub listen: Option<String>,
    pub verbose: bool,
    pub database_url: Option<String>,
    pub database_user: Option<String>,
    pub database_password: Option<String>,
    pub database_host: Option<String>,
    pub database_port: Option<u16>,
    pub database_name: Option<String>,
}