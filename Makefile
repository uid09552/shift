# Binary name (adjust if needed)
BIN := myapp

# Docker container name for PostgreSQL
CONTAINER ?= shift_postgres

# Default target
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  build          Build the project"
	@echo "  release        Build in release mode"
	@echo "  run            Run the app"
	@echo "  serve          Run 'serve' command"
	@echo "  ui-serve       Run Angular dev server (ng serve)"
	@echo "  db-up          Start PostgreSQL and NATS (deploy/docker-compose.yml)"
	@echo "  db-down        Stop PostgreSQL and NATS"
	@echo "  seed           Run seed_data_v2.py against the running server"
	@echo "  dev-run        Reset DB, run server, and seed data"
	@echo "  build-compose  Build docker-compose images (backend + postgres)"
	@echo "  up    Build and start docker-compose services"
	@echo "  down   Stop and remove docker-compose services"
	@echo "  check          Check code without building"
	@echo "  test           Run tests"
	@echo "  e2e-install    Install the Robot Framework e2e suite (one-time)"
	@echo "  e2e            Run the e2e UI tests against a running stack"
	@echo "  clean          Clean build artifacts"

.PHONY: build
build:
	cargo build

.PHONY: release
release:
	cargo build --release

.PHONY: run
run:
	cargo run

# Run your CLI serve command with optional args
# Usage: make serve PORT=3000 LISTEN=0.0.0.0 VERBOSE=1 DEV=1 TENANT_ID=0
.PHONY: serve
serve:
	cargo run -- serve \
		$(if $(PORT),--port $(PORT),) \
		$(if $(LISTEN),--listen $(LISTEN),) \
		$(if $(VERBOSE),--verbose,) \
		$(if $(DEV),--dev-mode,) \
		$(if $(TENANT_ID),--tenant-id $(TENANT_ID),)

.PHONY: ui-serve
ui-serve:
	cd ui && make serve

.PHONY: db-up
# PostgreSQL and NATS only — what `make serve` needs. The credentials match
# config.yaml's default database URL.
db-up:
	docker compose -f deploy/docker-compose.yml up -d postgres nats

.PHONY: db-down
db-down:
	docker compose -f deploy/docker-compose.yml stop postgres nats

.PHONY: check
check:
	cargo check

.PHONY: test
test:
	cargo test

# End-to-end UI tests (Robot Framework). Need a running stack — gateway, UI,
# backend and Keycloak. See e2e/README.md. Pass extra Robot arguments through
# ARGS, e.g. make e2e ARGS="-v BASE_URL:https://staging.example".
.PHONY: e2e-install
e2e-install:
	$(MAKE) -C e2e install

.PHONY: e2e
e2e:
	$(MAKE) -C e2e test $(if $(ARGS),ARGS="$(ARGS)",)

.PHONY: clean
clean:
	cargo clean

# Seed target — accepts optional BASE_URL override, e.g. make seed BASE_URL=http://localhost:8080/api/v1
SEED_URL ?= http://127.0.0.1:8081/api/v1

.PHONY: seed
seed:
	python3 seed_data_v2.py $(SEED_URL)

.PHONY: dev-run
dev-run:
	-killall shift
	#docker exec $(CONTAINER) psql -U postgres -c "DROP DATABASE IF EXISTS shift;"
	#docker exec $(CONTAINER) psql -U postgres -c "CREATE DATABASE shift;"
	cargo run -- serve \
		$(if $(PORT),--port $(PORT),) \
		$(if $(LISTEN),--listen $(LISTEN),) \
		$(if $(VERBOSE),--verbose,) \
		$(if $(DEV),--dev-mode,) \
		$(if $(TENANT_ID),--tenant-id $(TENANT_ID),) & sleep 2s && python3 seed_data_v2.py $(SEED_URL); wait

.PHONY: build-compose
build-compose:
	docker compose -f deploy/docker-compose.yml build

.PHONY: up
up:
	docker compose -f deploy/docker-compose.yml up --build -d

.PHONY: down
down:
	docker compose -f deploy/docker-compose.yml down