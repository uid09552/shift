#[allow(unused)]
use feature_api::*;

// Integration tests disabled - requires testcontainers setup
/*
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::ContainerAsync;

#[tokio::test]
async fn test_create_employee() {
    let postgres = Postgres::default().start().await.unwrap();
    let connection_string = format!(
        "postgres://postgres:postgres@localhost:{}/postgres",
        postgres.get_host_port_ipv4(5432).await.unwrap()
    );

    // Set DATABASE_URL for this test
    std::env::set_var("DATABASE_URL", &connection_string);

    let pool = database::establish_connection_pool();
    database::run_migrations(&pool);

    let repo = features::user_management::infrastructure::diesel_repository::DieselEmployeeRepository {
        pool: std::sync::Arc::new(pool),
    };

    let employee = repo.create_employee("John Doe", "john.doe@example.com").await.unwrap();
    assert_eq!(employee.name, "John Doe");
    assert_eq!(employee.email, "john.doe@example.com");
    assert!(!employee.id.to_string().is_empty());
}
*/