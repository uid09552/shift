use figment::{providers::{Env, Format, Serialized, Yaml}, Figment};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub broker: BrokerConfig,
    pub optimizer: OptimizerConfig,
    pub tenant: TenantConfig,
    pub keycloak: KeycloakConfig,
    pub otel: OtelConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub port: u16,
    pub listen: String,
    pub verbose: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantConfig {
    /// When true, every request is scoped to `tenant_id` instead of resolving a tenant from an auth token.
    pub dev_mode: bool,
    /// Default tenant used in dev mode. Later this will come from the auth token instead.
    pub tenant_id: String,
}

/// Keycloak admin connection used by the user-management endpoints. Empty `url`
/// means "no Keycloak": the server still starts, and `/users` answers 503.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeycloakConfig {
    /// Base URL including Keycloak's relative path, e.g. `http://localhost:8080/auth`.
    pub url: String,
    pub realm: String,
    /// Confidential client whose service account carries the `realm-management`
    /// roles — `shift-gateway` in the shipped realm.
    pub client_id: String,
    pub client_secret: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizerConfig {
    pub url: String,
}

/// OpenTelemetry export settings. Telemetry is off unless an endpoint is
/// configured here, on the command line, or via `OTEL_EXPORTER_OTLP_ENDPOINT`
/// — every field falls back to its standard OTel (or GitLab CI) environment
/// variable, so a plain `OTEL_*` environment needs no config file at all.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtelConfig {
    /// OTLP collector base URL, e.g. `https://<id>.otel.gitlab-o11y.com:14317`
    /// (gRPC) or `:14318` (HTTP). Empty = telemetry disabled.
    /// Env: `OTEL_EXPORTER_OTLP_ENDPOINT`.
    pub endpoint: String,
    /// `grpc` or `http` (`http/protobuf` is accepted too).
    /// Env: `OTEL_EXPORTER_OTLP_PROTOCOL`.
    pub protocol: String,
    /// Comma-separated `key=value` pairs sent with every export, e.g. an
    /// auth token. Env: `OTEL_EXPORTER_OTLP_HEADERS`.
    pub headers: String,
    /// `service.name`. Env: `OTEL_SERVICE_NAME`.
    pub service_name: String,
    /// `service.version` — the deployed commit. Env: `CI_COMMIT_SHA`.
    pub service_version: String,
    /// `deployment.environment.name`. Env: `CI_ENVIRONMENT_NAME`.
    pub environment: String,
    /// `gitlab.project.id` — required for GitLab Duo. Env: `CI_PROJECT_ID`.
    pub gitlab_project_id: String,
    /// `gitlab.project.name`. Env: `CI_PROJECT_NAME`.
    pub gitlab_project_name: String,
    /// Head-based sampling ratio for root spans, 0.0–1.0. Sampling decisions
    /// of an incoming trace are always respected.
    pub sample_ratio: f64,
}

impl OtelConfig {
    /// Fills every empty field from its standard environment variable.
    /// Config file and CLI values win over the environment.
    pub fn with_env_fallbacks(mut self) -> Self {
        fn env_or(current: String, keys: &[&str]) -> String {
            if !current.is_empty() {
                return current;
            }
            keys.iter()
                .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))
                .unwrap_or_default()
        }

        self.endpoint = env_or(self.endpoint, &["OTEL_EXPORTER_OTLP_ENDPOINT"]);
        self.protocol = env_or(self.protocol, &["OTEL_EXPORTER_OTLP_PROTOCOL"]);
        self.headers = env_or(self.headers, &["OTEL_EXPORTER_OTLP_HEADERS"]);
        self.service_name = env_or(self.service_name, &["OTEL_SERVICE_NAME"]);
        self.service_version = env_or(self.service_version, &["CI_COMMIT_SHA"]);
        self.environment = env_or(
            self.environment,
            &["OTEL_DEPLOYMENT_ENVIRONMENT", "CI_ENVIRONMENT_NAME"],
        );
        self.gitlab_project_id = env_or(self.gitlab_project_id, &["CI_PROJECT_ID"]);
        self.gitlab_project_name = env_or(self.gitlab_project_name, &["CI_PROJECT_NAME"]);

        if self.protocol.is_empty() {
            self.protocol = "grpc".to_string();
        }
        if self.service_name.is_empty() {
            self.service_name = "shift-backend".to_string();
        }
        self
    }

    /// Telemetry is exported only when an endpoint is known.
    pub fn enabled(&self) -> bool {
        !self.endpoint.trim().is_empty()
    }
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
            broker: BrokerConfig {
                host: "127.0.0.1".to_string(),
                port: 4222,
            },
            optimizer: OptimizerConfig {
                url: "http://localhost:8888".to_string(),
            },
            tenant: TenantConfig {
                dev_mode: false,
                tenant_id: "0".to_string(),
            },
            // Deliberately empty: user management is off until a deployment says
            // where its Keycloak is.
            keycloak: KeycloakConfig {
                url: String::new(),
                realm: "shift".to_string(),
                client_id: "shift-gateway".to_string(),
                client_secret: String::new(),
            },
            // Empty strings mean "take it from the environment" — see
            // OtelConfig::with_env_fallbacks. An empty endpoint disables OTel.
            otel: OtelConfig {
                endpoint: String::new(),
                protocol: String::new(),
                headers: String::new(),
                service_name: String::new(),
                service_version: String::new(),
                environment: String::new(),
                gitlab_project_id: String::new(),
                gitlab_project_name: String::new(),
                sample_ratio: 1.0,
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
            // `__` separates the levels, so a nested setting has an environment
            // variable: SHIFT_KEYCLOAK__CLIENT_SECRET -> keycloak.client_secret.
            .merge(Env::prefixed("SHIFT_").split("__"))
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
        if let Some(broker_host) = args.broker_host.clone() {
            figment = figment.merge(("broker.host", broker_host));
        }
        if let Some(broker_port) = args.broker_port {
            figment = figment.merge(("broker.port", broker_port));
        }
        if let Some(optimizer_url) = args.optimizer_url.clone() {
            figment = figment.merge(("optimizer.url", optimizer_url));
        }
        if args.dev_mode {
            figment = figment.merge(("tenant.dev_mode", true));
        }
        if let Some(tenant_id) = args.tenant_id.clone() {
            figment = figment.merge(("tenant.tenant_id", tenant_id));
        }
        if let Some(keycloak_url) = args.keycloak_url.clone() {
            figment = figment.merge(("keycloak.url", keycloak_url));
        }
        if let Some(keycloak_realm) = args.keycloak_realm.clone() {
            figment = figment.merge(("keycloak.realm", keycloak_realm));
        }
        if let Some(keycloak_client_id) = args.keycloak_client_id.clone() {
            figment = figment.merge(("keycloak.client_id", keycloak_client_id));
        }
        if let Some(keycloak_client_secret) = args.keycloak_client_secret.clone() {
            figment = figment.merge(("keycloak.client_secret", keycloak_client_secret));
        }
        if let Some(otel_endpoint) = args.otel_endpoint.clone() {
            figment = figment.merge(("otel.endpoint", otel_endpoint));
        }
        if let Some(otel_protocol) = args.otel_protocol.clone() {
            figment = figment.merge(("otel.protocol", otel_protocol));
        }
        if let Some(otel_service_name) = args.otel_service_name.clone() {
            figment = figment.merge(("otel.service_name", otel_service_name));
        }

        let mut config: Config = figment.extract()?;
        config.otel = config.otel.with_env_fallbacks();
        Ok(config)
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
    pub broker_host: Option<String>,
    pub broker_port: Option<u16>,
    pub optimizer_url: Option<String>,
    pub dev_mode: bool,
    pub tenant_id: Option<String>,
    pub keycloak_url: Option<String>,
    pub keycloak_realm: Option<String>,
    pub keycloak_client_id: Option<String>,
    pub keycloak_client_secret: Option<String>,
    pub otel_endpoint: Option<String>,
    pub otel_protocol: Option<String>,
    pub otel_service_name: Option<String>,
}