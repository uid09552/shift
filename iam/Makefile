.PHONY: up down start stop logs ps help bootstrap bootstrap-clean create-db

# Default target
up: create-db
	docker compose up -d

# Help - show login information
help:
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║              Ory Kratos & Hydra IAM                              ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║  Kratos (Identity Management):                                   ║"
	@echo "║    Public API:  http://localhost:4433                            ║"
	@echo "║    Admin API:   http://localhost:4434                            ║"
	@echo "║    UI:          http://localhost:4455                            ║"
	@echo "║                                                                   ║"
	@echo "║  Hydra (OAuth2/OIDC Provider):                                   ║"
	@echo "║    Public API:  http://localhost:4444                            ║"
	@echo "║    Admin API:   http://localhost:4445                            ║"
	@echo "║                                                                   ║"
	@echo "║  Bootstrap Commands:                                              ║"
	@echo "║    make bootstrap       - Create OAuth2 client for gateway       ║"
	@echo "║    make bootstrap-clean - Delete OAuth2 client                   ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"

# Create databases in postgres container before starting
create-db:
	@echo "Checking if databases exist in postgres container..."
	@docker exec shift_postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'kratos'" | grep -q 1 || \
		docker exec shift_postgres psql -U postgres -c "CREATE DATABASE kratos;"
	@docker exec shift_postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'hydra'" | grep -q 1 || \
		docker exec shift_postgres psql -U postgres -c "CREATE DATABASE hydra;"
	@docker exec shift_postgres psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname = 'kratos'" | grep -q 1 || \
		docker exec shift_postgres psql -U postgres -c "CREATE USER kratos WITH PASSWORD 'kratos';"
	@docker exec shift_postgres psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname = 'hydra'" | grep -q 1 || \
		docker exec shift_postgres psql -U postgres -c "CREATE USER hydra WITH PASSWORD 'hydra';"
	@docker exec shift_postgres psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE kratos TO kratos;" 2>/dev/null || true
	@docker exec shift_postgres psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE hydra TO hydra;" 2>/dev/null || true
	@echo "Databases ready."

# Initialize the stack (pull images and start)
init:
	docker compose pull
	docker compose up -d --wait

# Start services
start:
	docker compose start

# Stop services
stop:
	docker compose stop

# Stop and remove containers
down:
	docker compose down

# View logs
logs:
	docker compose logs -f

# Show status
ps:
	docker compose ps

# Restart all services
restart: down up

# Clean up (remove volumes too)
clean:
	docker compose down -v

# Bootstrap: Create OAuth2 client for gateway
bootstrap:
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║              BOOTSTRAP OAUTH2 CLIENT                             ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║  This will:                                                       ║"
	@echo "║  1. Create OAuth2 client for APISIX gateway                      ║"
	@echo "║  2. Configure APISIX OIDC plugin for /api location               ║"
	@echo "║  3. Configure bypass routes for Kratos/Hydra paths               ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"
	@echo ""
	python3 bootstrap.py bootstrap

# Clean up bootstrap: remove gateway config
bootstrap-clean:
	@echo "Cleaning up OAuth2 client and gateway config..."
	python3 bootstrap.py down
	@echo ""
	@echo "Cleanup complete. Gateway routes removed."
	@echo "Note: OAuth2 client still exists in Hydra."
	@echo "To fully reset, run: make clean && make up"
