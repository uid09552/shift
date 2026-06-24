# Deploy Makefile - orchestrates docker-compose for shift backend

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

# Individual service management
.PHONY: backend planner ui iam gateway

backend:
	docker-compose up -d backend

planner:
	docker-compose up -d planner

ui:
	docker-compose up -d planner-ui

iam:
	docker-compose up -d kratos hydra kratos-ui

gateway:
	docker-compose up -d apisix
