# Release Makefile — runs the published images from the GitLab registry.
# Nothing is built here; see ../deploy/Makefile for build/tag/push.

COMPOSE ?= docker compose

# Keycloak is a separate compose project (see iam/) — targets below prefixed
# "iam-" drive it.
IAM_COMPOSE ?= docker compose -f iam/docker-compose.yml --env-file iam/.env

.PHONY: all init pull up down restart ps logs config login clean tools \
        iam-up iam-down iam-logs iam-ps

all: up

# One-time setup: create the env files from their templates.
init:
	@test -f .env || (cp .env.example .env && echo "created .env — review the credentials")
	@test -f agent.env || (cp agent.env.example agent.env && echo "created agent.env — set the LLM API key")
	@test -f iam/.env || (cp iam/.env.example iam/.env && echo "created iam/.env — review the Keycloak credentials")

# Log in to the GitLab registry (needed only for private projects).
login:
	docker login registry.gitlab.com

pull:
	$(COMPOSE) pull

up:
	$(COMPOSE) up -d

# Include the optional tooling profile (n8n).
tools:
	$(COMPOSE) --profile tools up -d

down:
	$(COMPOSE) down

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

# Show the fully resolved compose file (verifies .env interpolation).
config:
	$(COMPOSE) config

# Removes containers AND volumes of THIS stack — application data is lost.
# Keycloak's realm/user data lives in the iam project and is untouched.
clean:
	$(COMPOSE) --profile tools down -v --remove-orphans

# --- Keycloak (separate compose project in iam/) -----------------------------
# Shares the external "backend" / "dev_backend" networks with the main stack:
#   docker network create backend && docker network create dev_backend

iam-up:
	$(IAM_COMPOSE) up -d

iam-down:
	$(IAM_COMPOSE) down

iam-ps:
	$(IAM_COMPOSE) ps

iam-logs:
	$(IAM_COMPOSE) logs -f
