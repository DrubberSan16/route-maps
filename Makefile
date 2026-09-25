# Maps Platform - comandos habituales. Windows/PowerShell: .\make.ps1 <comando>
#
#   make init                            crea .env con secretos aleatorios
#   make up                              construye y levanta el stack
#   make prepare-region REGION=guayaquil descarga + mapa + routing + registro
#   make help                            todos los comandos

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
PROD := $(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml
TOOLS := $(COMPOSE) --profile tools run --rm data-tools
BACKEND_RUN := $(COMPOSE) run --rm -e RUN_MIGRATIONS=false -e SEED_DEMO_DATA=false backend
REGION ?=
SERVICE ?=
PREPARE_FLAGS := $(if $(SKIP_ROUTING),--skip-routing) $(if $(WATER),--water-polygons) $(if $(FORCE),--force-download)

.PHONY: help init up down restart ps logs build config migrate seed regions regions-sync \
        download-region build-map build-routing prepare-region geocoding-up \
        prod-up prod-down prod-logs test test-backend test-tilegen test-mobile lint check-region

help: ## Muestra esta ayuda
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Variables: REGION=<código> SERVICE=<servicio> SKIP_ROUTING=1 WATER=1 FORCE=1"

init: ## Crea .env desde .env.example con secretos aleatorios
	@./infrastructure/scripts/init-env.sh

up: ## Construye y levanta nginx, backend, postgres, redis y routing
	$(COMPOSE) up -d --build

down: ## Detiene el stack (conserva volúmenes y ./storage)
	$(COMPOSE) down

restart: ## Reinicia un servicio (SERVICE=backend) o todo el stack
	$(COMPOSE) restart $(SERVICE)

ps: ## Estado y salud de los servicios
	$(COMPOSE) ps

logs: ## Sigue los logs (SERVICE=backend para uno solo)
	$(COMPOSE) logs -f --tail=200 $(SERVICE)

build: ## Construye todas las imágenes, incluida data-tools
	$(COMPOSE) --profile tools build

config: ## Valida docker-compose.yml con las variables de .env
	$(COMPOSE) config --quiet && echo "Configuración de Docker Compose válida"

migrate: ## Aplica las migraciones pendientes de Prisma
	$(BACKEND_RUN) ./node_modules/.bin/prisma migrate deploy

seed: ## Carga usuarios y datos de demostración (idempotente)
	$(BACKEND_RUN) node dist/prisma/seed.js

regions: ## Lista las regiones del catálogo y lo ya generado
	$(TOOLS) list

regions-sync: ## Registra en el backend las regiones preparadas
	$(COMPOSE) exec -T backend node dist/src/cli/sync-regions.js

check-region:
	@[[ "$(REGION)" =~ ^[a-z0-9][a-z0-9-]{1,62}$$ ]] || { echo "Uso: make $(MAKECMDGOALS) REGION=<código> (ver: make regions)"; exit 64; }

download-region: check-region ## Descarga (o recorta) el extracto OSM: REGION=guayaquil
	$(TOOLS) download $(REGION) $(if $(FORCE),--force-download)

build-map: check-region ## Genera el mapa PMTiles de una región descargada (WATER=1: océanos)
	$(TOOLS) map $(REGION) $(if $(WATER),--water-polygons)

build-routing: check-region ## Genera el grafo de routing Valhalla de una región descargada
	$(TOOLS) routing $(REGION)

prepare-region: check-region ## Descarga + mapa + routing + manifiesto + registro: REGION=guayaquil
	./infrastructure/scripts/download-region.sh $(REGION) $(PREPARE_FLAGS)

geocoding-up: ## Levanta Nominatim (la primera vez importa el extracto de NOMINATIM_REGION)
	$(COMPOSE) --profile geocoding up -d

prod-up: ## Producción: construye y levanta con docker-compose.prod.yml
	$(PROD) up -d --build

prod-down: ## Producción: detiene el stack
	$(PROD) down

prod-logs: ## Producción: sigue los logs
	$(PROD) logs -f --tail=200 $(SERVICE)

test: test-backend test-tilegen test-mobile ## Ejecuta todas las pruebas (backend, tilegen, Flutter)

test-backend: ## Pruebas del backend (Jest)
	cd backend && npm test

test-tilegen: ## Pruebas del generador de mapas (Maven, Java 21)
	mvn -B -f infrastructure/maps/tilegen/pom.xml test

test-mobile: ## Pruebas de la app Flutter
	cd mobile && flutter test

lint: ## Lint y formato del backend, flutter analyze
	cd backend && npm run lint && npm run format:check
	cd mobile && dart format --output=none --set-exit-if-changed lib test && flutter analyze
