# Database Setup

This project uses PostgreSQL for data storage. You can run a local PostgreSQL instance using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- WSL 2 integration enabled in Docker Desktop (if using WSL)

## Starting the Database

```bash
make db-up
```

This will start a PostgreSQL container with the following configuration:
- Database: `shift`
- User: `shift_user`
- Password: `shift_password`
- Port: `5432`

## Stopping the Database

```bash
make db-down
```

## Environment Variables

Set the following environment variable to connect to the database:

```bash
export DATABASE_URL=postgresql://shift_user:shift_password@localhost:5432/shift
```

Or set individual components:

```bash
export DATABASE_USER=shift_user
export DATABASE_PASSWORD=shift_password
export DATABASE_HOST=localhost
export DATABASE_PORT=5432
export DATABASE_NAME=shift
```

### Command Line Arguments

You can also pass database configuration as CLI arguments:

```bash
cargo run -- serve --database-url postgresql://user:pass@host:port/db
# or
cargo run -- serve --database-user myuser --database-password mypass --database-host localhost --database-port 5432 --database-name mydb
```

### Configuration Priority

Configuration sources are merged in this order (later sources override earlier ones):
1. Default values
2. Environment variables (prefixed with `SHIFT_` or raw)
3. Command line arguments

Or create a `.env` file in the project root with:

```
DATABASE_URL=postgresql://shift_user:shift_password@localhost:5432/shift
```

## Running Migrations

After starting the database, run the Diesel migrations:

```bash
cargo run --bin diesel migration run
```

Or use the existing make target:

```bash
make serve
```

(The serve command automatically runs migrations)