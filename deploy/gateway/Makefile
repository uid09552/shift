#
# APISIX Gateway - Standalone Mode
#

.PHONY: up down start stop logs ps help clean

# Default target
up:
	docker compose -f docker-compose-standalone.yml up -d

# Help - show available commands
help:
	@echo "╔══════════════════════════════════════════════════════════════════╗"
	@echo "║              APISIX Gateway - Standalone Mode                    ║"
	@echo "╠══════════════════════════════════════════════════════════════════╣"
	@echo "║  APISIX Gateway:                                                 ║"
	@echo "║    HTTP:        http://localhost:9080                            ║"
	@echo "║    Admin API:   http://localhost:9180                            ║"
	@echo "║    HTTPS:       https://localhost:9443                           ║"
	@echo "║                                                                   ║"
	@echo "║  Commands:                                                        ║"
	@echo "║    make up       - Start APISIX in standalone mode               ║"
	@echo "║    make down     - Stop and remove containers                    ║"
	@echo "║    make start    - Start stopped containers                      ║"
	@echo "║    make stop     - Stop containers                               ║"
	@echo "║    make logs     - View logs                                     ║"
	@echo "║    make ps       - Show status                                   ║"
	@echo "║    make clean    - Remove containers and volumes                 ║"
	@echo "╚══════════════════════════════════════════════════════════════════╝"

# Initialize the stack (pull images and start)
init:
	docker compose -f docker-compose-standalone.yml pull
	docker compose -f docker-compose-standalone.yml up -d --wait

# Start services
start:
	docker compose -f docker-compose-standalone.yml start

# Stop services
stop:
	docker compose -f docker-compose-standalone.yml stop

# Stop and remove containers
down:
	docker compose -f docker-compose-standalone.yml down

# View logs
logs:
	docker compose -f docker-compose-standalone.yml logs -f

# Show status
ps:
	docker compose -f docker-compose-standalone.yml ps

# Restart all services
restart: down up

# Clean up (remove volumes too)
clean:
	docker compose -f docker-compose-standalone.yml down -v
