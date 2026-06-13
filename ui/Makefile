COMPOSE_FILE = deploy/docker-compose.yml

.PHONY: build up down logs ps serve

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

serve:
	npx ng serve --host 0.0.0.0 --port 4200
