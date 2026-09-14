# Sieve — Makefile
#
# Canonical targets, same names as every other project. `make` on its own
# prints this list.
#
# Two things about this project shape the wiring below:
#
#   1. There is NO database container. SQLite is a file (./data/sieve.db), and
#      the embedding model runs in-process. So there is no infra to bring up
#      before developing — `make dev` needs nothing running.
#   2. Migrations are applied AT BOOT by instrumentation.ts, idempotently, in
#      every environment. The container healthcheck gates on /api/v1/health,
#      which requires a migrated DB, so `up -d --wait` already implies
#      "migrations applied". The production image is a Next standalone build
#      with no devDependencies and no tsx, so `pnpm db:migrate` deliberately is
#      NOT run inside it — it would fail. `make db-migrate` is for the host.
#
# Stacks:
#   compose.yml                      local container stack  (start/stop/...)
#   compose.yml + compose.prod.yml   production, GHCR image (production/...)
#
# Two ways to run the app locally, both on port 3060 — use one at a time:
#   make start   containers, production-like, no hot reload
#   make dev     host dev server, hot reload   (stops containers first)

SHELL          := /bin/bash
COMPOSE        := docker compose
DEV_FILE       := compose.yml
PROD_FILE      := compose.prod.yml
DEV            := $(COMPOSE) -f $(DEV_FILE)
PROD           := $(COMPOSE) -f $(DEV_FILE) -f $(PROD_FILE)
APP_SERVICE    := sieve
ENV_FILE       := .env
ENV_EXAMPLE    := .env.example
SQLITE_FILE    := ./data/sieve.db
APP_URL        := http://localhost:3060

.DEFAULT_GOAL := help

# ─── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show this help
	@echo "Sieve — available make targets:"
	@echo ""
	@# NOTE the 0-9 in the character class: without it, any target with a digit in its
	@# name (test-e2e) silently vanishes from this help output.
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  First time here?  make install-all  then  make dev"

# ─── Lifecycle (local container stack — default) ────────────────────────────────
.PHONY: start stop restart status logs dev
start: env-check ## Start the local container stack (migrations run at boot) → :3060
	$(DEV) up -d --wait
	@echo ""
	@echo "Sieve is up at $(APP_URL)  (migrations applied at boot)"
	@echo "Containers stay running after this returns — 'make stop' halts them."
	@echo "For hot reload instead, use 'make dev'."

stop: ## Halt the container stack (containers kept — resume with 'make start')
	$(DEV) stop

restart: ## Restart the container stack
	$(DEV) restart
	@echo ""
	@echo "Restarted. Migrations re-applied at boot (idempotent)."

status: ## Show container status
	$(DEV) ps

logs: ## Tail container logs (Ctrl+C to exit)
	$(DEV) logs -f --tail=200

dev: env-check ## Run the host dev server with hot reload → :3060
	@if [ -n "$$($(DEV) ps -q $(APP_SERVICE) 2>/dev/null)" ]; then \
		echo "Container stack is using port 3060 — halting it first..."; \
		$(DEV) stop; \
	fi
	pnpm db:migrate
	@echo ""
	@echo "Starting dev server → $(APP_URL)"
	pnpm dev

# ─── Lifecycle (production) ────────────────────────────────────────────────────
.PHONY: production production-stop production-restart production-status production-logs
production: env-check ## Start the production stack from the GHCR image
	$(PROD) pull
	$(PROD) up -d --wait
	@echo ""
	@echo "Production stack up. Migrations applied at boot by instrumentation.ts."

production-stop: ## Halt the production stack
	$(PROD) stop

production-restart: ## Restart the production stack
	$(PROD) restart

production-status: ## Show production container status
	$(PROD) ps

production-logs: ## Tail production logs
	$(PROD) logs -f --tail=200

# ─── Install ───────────────────────────────────────────────────────────────────
.PHONY: install install-all install-deps install-images
install: install-all ## Alias for 'install-all'

install-all: env-init install-deps db-migrate db-seed model-warm ## Full first-time setup
	@echo ""
	@echo "Setup complete. Next steps:"
	@echo "  • make dev          host dev server, hot reload"
	@echo "  • make start        local container stack"
	@echo "  • make smoke-ai     verify the live OpenRouter wiring (~2 free requests)"
	@echo ""
	@echo "Reminder: GITHUB_PAT in .env lifts the GitHub API from 60 to 5,000 req/hr."

install-deps: ## Install pnpm dependencies (compiles 3 native modules — slow first time)
	pnpm install

install-images: ## Build the local docker image
	$(DEV) build

model-warm: ## Download + cache the local embedding model (~128 MB, once)
	@echo "Warming the bge-small-en-v1.5 cache so the first captured link isn't a 128 MB download..."
	pnpm warm:model

# ─── Environment ───────────────────────────────────────────────────────────────
.PHONY: env-check env-init
env-check: ## Verify .env exists (warn only)
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "WARNING: $(ENV_FILE) not found. Run 'make env-init', then fill in OPENROUTER_API_KEY."; \
	fi

env-init: ## Create .env from .env.example if missing
	@if [ -f $(ENV_FILE) ]; then \
		echo "$(ENV_FILE) already exists — leaving it untouched."; \
	else \
		cp $(ENV_EXAMPLE) $(ENV_FILE) && echo "Created $(ENV_FILE). Fill in OPENROUTER_API_KEY (required) and GITHUB_PAT (recommended)."; \
	fi

# ─── Database ──────────────────────────────────────────────────────────────────
.PHONY: db-migrate db-generate db-seed db-studio db-backup db-reset reembed
db-migrate: ## Apply migrations to the host DB (idempotent)
	pnpm db:migrate

db-generate: ## Generate a new drizzle migration from schema.ts
	pnpm db:generate

db-seed: ## Create the single user from SEED_USER_* in .env (idempotent)
	pnpm seed:user

db-studio: ## Browse the database with drizzle-kit studio
	pnpm exec drizzle-kit studio

db-backup: ## Snapshot the SQLite file (VACUUM INTO, safe while running)
	bash deploy/backup.sh

db-reset: ## Delete the database and re-migrate + re-seed (DESTRUCTIVE)
	@read -p "This DELETES $(SQLITE_FILE) and everything you have saved. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		rm -f $(SQLITE_FILE) $(SQLITE_FILE)-wal $(SQLITE_FILE)-shm; \
		pnpm db:migrate && pnpm seed:user; \
	else \
		echo "Aborted."; \
	fi

reembed: ## Re-embed every chunk (required after changing the embedding model)
	pnpm reembed

# ─── Shells / one-offs ─────────────────────────────────────────────────────────
.PHONY: sh-app sqlite health
sh-app: ## Open a shell in the running app container
	$(DEV) exec $(APP_SERVICE) sh

sqlite: ## Open the SQLite CLI against the database file
	sqlite3 $(SQLITE_FILE)

health: ## Print the health endpoint (db, queue, disk, llm quota)
	@curl -s $(APP_URL)/api/v1/health | python3 -m json.tool || echo "Not responding — is it running?"

# ─── Build / lint / test ───────────────────────────────────────────────────────
.PHONY: build build-ext lint format typecheck check test test-ui test-unit test-integration test-e2e
build: ## Production build
	pnpm build

build-ext: ## Build the browser extension into extension/dist
	pnpm build:ext
	@echo ""
	@echo "Built. Two ways to install it:"
	@echo "  • Settings → Connect your devices → Download sieve-extension.zip  (works remotely)"
	@echo "  • chrome://extensions → Developer mode → Load unpacked → extension/dist"
	@echo ""
	@echo "The production image builds this too, so the download works on the VPS." 

lint: ## Run eslint
	pnpm lint

format: ## Format with prettier
	pnpm format

typecheck: ## Run tsc --noEmit
	pnpm typecheck

check: ## format:check + lint + typecheck (what CI gates on)
	pnpm check

test: ## Run the whole test suite
	pnpm test

test-ui: ## Run tests in watch mode
	pnpm test:watch

test-unit: ## Unit tests only
	pnpm test:unit

test-integration: ## Integration tests only (real in-memory SQLite)
	pnpm test:integration

test-e2e: ## Playwright end-to-end tests
	pnpm test:e2e

# ─── Evals / AI verification ───────────────────────────────────────────────────
.PHONY: eval eval-rag smoke-ai
eval: ## Retrieval eval — context precision + recall (local, zero API cost)
	pnpm eval

eval-rag: ## Generation eval — faithfulness + answer relevancy (SPENDS free-tier requests)
	pnpm eval:rag

smoke-ai: ## Live end-to-end AI check against OpenRouter (~2 free-tier requests)
	pnpm smoke:ai

# ─── Deploy ────────────────────────────────────────────────────────────────────
.PHONY: deploy
deploy: ## How to deploy (spoiler: git push) and how to roll back by hand
	@echo "Deploys are automatic: every push to master builds, pushes to GHCR,"
	@echo "and rolls the VPS container. Just:"
	@echo ""
	@echo "    git push origin master"
	@echo ""
	@echo "Then watch it in GitHub -> Actions. If the new container doesn't go"
	@echo "healthy within 120s, deploy.sh rolls back to the previous image by"
	@echo "itself and the run goes red."
	@echo ""
	@echo "To roll back to a specific tag by hand (same script, same code path):"
	@echo ""
	@echo "    ssh contabo"
	@echo "    bash ~/apps/sieve/deploy/deploy.sh ghcr.io/majorabdullah/research-tool:sha-<sha>"
	@echo ""
	@echo "deploy.sh runs ON THE VPS and needs an image ref -- running it here"
	@echo "would try to deploy to your laptop. Setup: deploy/README.md"

# ─── Cleanup ───────────────────────────────────────────────────────────────────
.PHONY: clean clean-volumes nuke
clean: ## Stop and remove containers (keeps the database and model cache)
	-$(PROD) down
	-$(DEV) down

clean-volumes: ## Remove containers AND named volumes (DESTRUCTIVE)
	@read -p "This DELETES named volumes. ./data (your database) is a bind mount and survives. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		$(PROD) down -v; $(DEV) down -v; \
	else \
		echo "Aborted."; \
	fi

nuke: ## Containers + volumes + local images + model cache (DESTRUCTIVE)
	@read -p "Full reset: containers, volumes, local images, and the 128 MB model cache. Your database in ./data survives. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		$(PROD) down -v --rmi local; $(DEV) down -v --rmi local; \
		rm -rf .fastembed_cache .next; \
		docker image prune -f; \
	else \
		echo "Aborted."; \
	fi
