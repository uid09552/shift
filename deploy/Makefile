# Deploy Makefile - orchestrates docker-compose for shift backend

# Registry to tag/push built images to. Override on the command line, e.g.:
#   make push VERSION=1.2.3
#   make push-all REGISTRY=registry.example.com/other-project
REGISTRY ?= registry.gitlab.com/uid09552/shift
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo latest)

# Locally-built image names (see the "image:" field on each buildable
# service in docker-compose.yml) mapped to their registry image name.
# "mcp" reuses the "agent" image (same Dockerfile, same content) so it isn't
# tagged/pushed separately.
IMAGES := backend planner ui agent

.PHONY: all up down ps logs build clean

all: up

up:
	docker-compose up -d

down:
	docker-compose down

ps:
	docker-compose ps

logs:
	docker-compose logs -f

build:
	docker-compose build

clean:
	docker-compose down -v --remove-orphans

# Registry tag/push
.PHONY: version tag push push-all

version:
	@echo $(VERSION)

# Tags each locally-built image (shift-<name>:local, see the "image:" field
# in docker-compose.yml) as $(REGISTRY)/<name>:$(VERSION) and :latest.
tag: build
	@for img in $(IMAGES); do \
		echo "Tagging shift-$$img:local -> $(REGISTRY)/$$img:$(VERSION)"; \
		docker tag shift-$$img:local $(REGISTRY)/$$img:$(VERSION); \
		docker tag shift-$$img:local $(REGISTRY)/$$img:latest; \
	done

# Pushes the tags created by `make tag` — run `make tag` first (or use
# push-all, which does both).
push:
	@for img in $(IMAGES); do \
		echo "Pushing $(REGISTRY)/$$img:$(VERSION)"; \
		docker push $(REGISTRY)/$$img:$(VERSION); \
		docker push $(REGISTRY)/$$img:latest; \
	done

# Build, tag, and push every image in one go.
push-all: tag push

# Individual service management
.PHONY: backend planner agent mcp ui iam gateway

backend:
	docker-compose up -d backend

planner:
	docker-compose up -d planner

agent:
	docker-compose up -d agent

mcp:
	docker-compose up -d mcp

ui:
	docker-compose up -d planner-ui

iam:
	docker-compose up -d kratos hydra kratos-ui

gateway:
	docker-compose up -d apisix
