.PHONY: install sync run schedule nats api clean test

# Default target
all: install

# Install uv if not present, then sync dependencies
install:
	@which uv > /dev/null 2>&1 || (curl -LsSf https://astral.sh/uv/install.sh | sh)
	uv sync

# Sync dependencies (use after editing pyproject.toml)
sync:
	uv sync

# Run scheduler once with default input/output files
schedule:
	uv run shift-planner schedule

# Run scheduler with custom input/output
schedule-custom:
	uv run shift-planner schedule input_shift.json my_output.json

# Start NATS JetStream subscriber server
nats:
	uv run shift-planner nats

# Start NATS with custom options
nats-custom:
	uv run shift-planner nats --queue-name scheduling --stream-name SCHEDULING --broker-url nats://localhost:4222

# Start REST API server (default: 0.0.0.0:8888)
api:
	uv run shift-planner api

# Start REST API with custom host/port
api-custom:
	uv run shift-planner api --host 127.0.0.1 --port 8080

# Start REST API in debug mode
api-debug:
	uv run shift-planner api --debug

# Quick smoke test of the API
test-api:
	@echo "Starting API server for testing..."
	@uv run shift-planner api --port 5099 &
	@sleep 3
	@echo "--- Health check ---"
	@curl -s http://localhost:5099/api/v1/health | python3 -m json.tool
	@echo ""
	@echo "--- API info ---"
	@curl -s http://localhost:5099/api/v1/ | python3 -m json.tool
	@echo ""
	@echo "--- Schedule request ---"
	@curl -s -X POST http://localhost:5099/api/v1/optimize -H "Content-Type: application/json" -d @input_shift.json | python3 -m json.tool 2>&1 | head -30
	@echo ""
	@echo "Stopping test server..."
	@kill %1 2>/dev/null || true

# Clean build artifacts and virtual environment
clean:
	rm -rf .venv dist *.egg-info
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Show available commands
help:
	@echo "Shift Planner - Available commands:"
	@echo ""
	@echo "  make install        Install uv and sync dependencies"
	@echo "  make sync           Re-sync dependencies after pyproject.toml changes"
	@echo "  make schedule       Run scheduler once (input.json → output.json)"
	@echo "  make schedule-custom  Run with custom files (input_shift.json)"
	@echo "  make nats           Start NATS JetStream subscriber"
	@echo "  make nats-custom    Start NATS with custom options"
	@echo "  make api            Start REST API server (0.0.0.0:8888)"
	@echo "  make api-custom     Start REST API on 127.0.0.1:8080"
	@echo "  make api-debug      Start REST API in debug mode"
	@echo "  make test-api       Smoke test the REST API"
	@echo "  make clean          Remove .venv and build artifacts"
	@echo "  make help           Show this help"
