# Binary name (adjust if needed)
BIN := myapp

# Default target
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  build        Build the project"
	@echo "  release      Build in release mode"
	@echo "  run          Run the app"
	@echo "  serve        Run 'serve' command"
	@echo "  db-up        Start PostgreSQL database with docker-compose"
	@echo "  db-down      Stop PostgreSQL database"
	@echo "  check        Check code without building"
	@echo "  test         Run tests"
	@echo "  clean        Clean build artifacts"

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
# Usage: make serve PORT=3000 LISTEN=0.0.0.0 VERBOSE=1 DEV=1
.PHONY: serve
serve:
	cargo run -- serve \
		$(if $(PORT),--port $(PORT),) \
		$(if $(LISTEN),--listen $(LISTEN),) \
		$(if $(VERBOSE),--verbose,) \
		$(if $(DEV),--dev,)

.PHONY: db-up
db-up:
	docker compose up -d

.PHONY: db-down
db-down:
	docker compose down

.PHONY: check
check:
	cargo check

.PHONY: test
test:
	cargo test

.PHONY: clean
clean:
	cargo clean