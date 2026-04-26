use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use std::time::Duration;
use crate::config::DatabaseConfig;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type DbPool = Pool<ConnectionManager<PgConnection>>;

pub fn establish_connection_pool(config: &DatabaseConfig) -> DbPool {
    let manager = ConnectionManager::<PgConnection>::new(&config.url);
    Pool::builder()
        .connection_timeout(Duration::from_secs(30))
        .build(manager)
        .expect("Failed to create pool.")
}

pub fn run_migrations(pool: &DbPool) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut conn = pool.get()?;
    conn.run_pending_migrations(MIGRATIONS)?;
    Ok(())
}