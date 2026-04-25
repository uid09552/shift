use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use crate::config::DatabaseConfig;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type DbPool = Pool<ConnectionManager<PgConnection>>;

pub fn establish_connection_pool(config: &DatabaseConfig) -> DbPool {
    let manager = ConnectionManager::<PgConnection>::new(&config.url);
    Pool::builder()
        .build(manager)
        .expect("Failed to create pool.")
}

pub fn run_migrations(pool: &DbPool) {
    let mut conn = pool.get().expect("Failed to get connection from pool");
    conn.run_pending_migrations(MIGRATIONS).unwrap();
}