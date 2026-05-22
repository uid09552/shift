COMPOSE_FILE = deploy/docker-compose.yml

.PHONY: build up down logs ps

build:
	docker compose -f $(COMPOSE_FILE) build

up:
	docker compose -f $(COMPOSE_FILE) up -d

down:
	docker compose -f $(COMPOSE_FILE) down

logs:
	docker compose -f $(COMPOSE_FILE) logs -f

ps:
	docker compose -f $(COMPOSE_FILE) ps
