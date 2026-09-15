//! What is running: the version, commit and build date of this backend.
//!
//! Two sources, the first non-empty one wins:
//!
//! 1. the `build` section of the configuration (`build.version`, or
//!    `SHIFT_BUILD__VERSION` in the environment) — for a deployment that wants
//!    to state its version without rebuilding;
//! 2. what the build baked in: `APP_VERSION`, `GIT_COMMIT` and `BUILD_DATE` in
//!    the environment of `cargo build`. GitLab CI passes them as Docker build
//!    arguments (see `deploy/Dockerfile.backend`).
//!
//! A local build without either reports the crate version and no commit.

use std::sync::OnceLock;

use axum::Json;
use serde::Serialize;

use crate::config::BuildConfig;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BuildInfo {
    pub name: &'static str,
    pub version: String,
    /// Full commit SHA, empty when unknown.
    pub commit: String,
    /// ISO 8601, empty when unknown.
    pub build_date: String,
}

static CURRENT: OnceLock<BuildInfo> = OnceLock::new();

impl BuildInfo {
    /// The configured values over the compiled-in ones.
    pub fn resolve(config: &BuildConfig) -> Self {
        Self::from_parts(
            config,
            option_env!("APP_VERSION"),
            option_env!("GIT_COMMIT"),
            option_env!("BUILD_DATE"),
        )
    }

    fn from_parts(
        config: &BuildConfig,
        version: Option<&str>,
        commit: Option<&str>,
        build_date: Option<&str>,
    ) -> Self {
        fn pick(configured: &str, compiled: Option<&str>) -> Option<String> {
            [Some(configured), compiled]
                .into_iter()
                .flatten()
                .map(str::trim)
                .find(|v| !v.is_empty())
                .map(str::to_string)
        }
        Self {
            name: "shift-backend",
            version: pick(&config.version, version)
                .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
            commit: pick(&config.commit, commit).unwrap_or_default(),
            build_date: pick(&config.date, build_date).unwrap_or_default(),
        }
    }

    /// Fixes what `GET /info` reports for the rest of the process. Called once
    /// at startup; later calls are ignored.
    pub fn init(config: &BuildConfig) -> &'static BuildInfo {
        CURRENT.get_or_init(|| Self::resolve(config))
    }

    /// What `init` fixed — or, where nothing called it (tests), the build's own.
    pub fn current() -> &'static BuildInfo {
        CURRENT.get_or_init(|| Self::resolve(&BuildConfig::default()))
    }
}

/// GET /info
pub async fn get_info() -> Json<BuildInfo> {
    Json(BuildInfo::current().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(version: &str, commit: &str, date: &str) -> BuildConfig {
        BuildConfig { version: version.into(), commit: commit.into(), date: date.into() }
    }

    #[test]
    fn the_build_flag_is_used_when_nothing_is_configured() {
        let info = BuildInfo::from_parts(&config("", "", ""), Some("1.4.0"), Some("abc123"), Some("2026-09-15T08:00:00Z"));
        assert_eq!(info.version, "1.4.0");
        assert_eq!(info.commit, "abc123");
        assert_eq!(info.build_date, "2026-09-15T08:00:00Z");
    }

    #[test]
    fn configuration_overrides_the_build_flag() {
        let info = BuildInfo::from_parts(&config("2.0.0-hotfix", "", ""), Some("1.4.0"), Some("abc123"), None);
        assert_eq!(info.version, "2.0.0-hotfix");
        assert_eq!(info.commit, "abc123", "an empty setting falls through to the build");
    }

    #[test]
    fn a_plain_local_build_reports_the_crate_version() {
        // Docker passes an unset build argument as an empty string.
        let info = BuildInfo::from_parts(&config("", "", ""), Some(""), None, Some("  "));
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.commit, "");
        assert_eq!(info.build_date, "");
    }
}
