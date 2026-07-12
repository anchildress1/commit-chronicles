.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help install dev format format-check lint typecheck test build e2e perf secret-scan ai-checks deploy gcp-bootstrap snowflake-deploy cards-stale cards-rerender clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies and git hooks
	npm ci

dev: ## Run the API and the SPA together
	npm run dev

format: ## Format the tree
	npm run format

format-check: ## Fail on unformatted files
	npm run format:check

lint: ## Lint (warnings are errors)
	npm run lint -- --max-warnings=0

typecheck: ## Typecheck without emitting
	npm run typecheck

test: ## Unit tests with coverage thresholds
	npm test

build: ## Build the SPA and the server
	npm run build

e2e: ## Playwright end-to-end tests
	npm run e2e

# Lighthouse never runs in CI — it lives here and only here.
perf: build ## Lighthouse audit against a local production build
	npx --yes @lhci/cli autorun --collect.staticDistDir=dist/client

secret-scan: ## Scan the working tree for secrets
	@command -v gitleaks >/dev/null 2>&1 \
		|| { echo "gitleaks not found — brew install gitleaks"; exit 1; }
	gitleaks detect --no-banner --redact

ai-checks: format-check lint typecheck test build ## The full gate an agent must pass before handing work back

# There is no default `snow` connection on this machine, so the connection is named.
# The key is passphrase-protected: export PRIVATE_KEY_PASSPHRASE before running.
SNOW ?= snow sql -c chronicles

cards-rerender: ## Redraw stored cards with the current renderer (no Cortex spend)
	npx tsx --env-file-if-exists=.env src/server/rerender.ts $(REPOS)

cards-stale: ## List cards written by a pipeline that no longer exists
	$(SNOW) -q "SELECT REPO_OWNER, REPO_NAME, WRITTEN_BY, CURRENT_VERSION, GENERATED_AT FROM STALE_CARDS ORDER BY GENERATED_AT;"

snowflake-deploy: ## Deploy every warehouse object, in dependency order
	$(SNOW) -f snowflake/schema.sql
	$(SNOW) -f snowflake/ingest_pipeline.sql
	$(SNOW) -f snowflake/detector.sql
	$(SNOW) -f snowflake/ai_functions.sql
	$(SNOW) -f snowflake/read_repo.sql

gcp-bootstrap: ## Create the GCP resources deploy.sh expects (idempotent, one-off)
	./scripts/gcp-bootstrap.sh

deploy: ## Build the image and deploy to Cloud Run
	./deploy.sh

clean: ## Remove build output
	rm -rf dist coverage playwright-report test-results .vite
