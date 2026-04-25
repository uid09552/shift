# Hospital Shift Management System

A Rust-based backend service for managing hospital shift scheduling and employee assignments.

## Features

- REST API for managing employees, shifts, capabilities, and workstations
- PostgreSQL database with Diesel ORM
- Axum web framework
- Hexagonal architecture with domain services

## Quick Start

1. **Start the database:**
   ```bash
   make db-up
   ```

2. **Set environment variables:**
   ```bash
   export DATABASE_URL=postgresql://shift_user:shift_password@localhost:5432/shift
   ```

3. **Run the server:**
   ```bash
   make serve
   ```

## API Documentation

See [api/README.md](api/README.md) for the complete OpenAPI specification.

## Database Setup

See [DATABASE.md](DATABASE.md) for detailed database setup instructions.

## Development

### Available Make Targets

- `make build` - Build the project
- `make release` - Build in release mode
- `make serve` - Start the server
- `make db-up` - Start PostgreSQL database
- `make db-down` - Stop PostgreSQL database
- `make test` - Run tests
- `make check` - Check code without building
- `make clean` - Clean build artifacts

### Server Options

```bash
cargo run -- serve --help
```

Options:
- `--port <PORT>` - Port to listen on (default: 8080)
- `--listen <ADDRESS>` - Address to bind to (default: 127.0.0.1)
- `--verbose` - Enable verbose logging
- `--database-url <URL>` - Database connection URL
- `--database-user <USER>` - Database user
- `--database-password <PASSWORD>` - Database password
- `--database-host <HOST>` - Database host
- `--database-port <PORT>` - Database port
- `--database-name <NAME>` - Database name