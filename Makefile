.PHONY: install dev format format-files format-check lint typecheck test build e2e perf secret-scan actionlint deploy ai-checks clean

# Install all dependencies
install:
	@echo "📦 Installing dependencies..."
	pnpm install

# Start development server
dev:
	@echo "🚀 Starting development server..."
	pnpm dev

# Format the whole repo
format:
	@echo "✨ Formatting code..."
	pnpm format

# Format only the files passed in FILES (used by the pre-commit hook)
format-files:
	@if [ -n "$(FILES)" ]; then pnpm exec prettier --write --ignore-unknown $(FILES); fi

# Check formatting (non-destructive, for CI)
format-check:
	@echo "✨ Checking formatting..."
	pnpm format:check

# Lint code
lint:
	@echo "🔍 Linting code..."
	pnpm lint

# TypeScript type check
typecheck:
	@echo "🔎 Type checking..."
	pnpm typecheck

# Run unit tests with coverage
test:
	@echo "🧪 Running unit tests..."
	pnpm test

# Production build
build:
	@echo "🏗️ Building project..."
	pnpm build

# Run Playwright E2E tests
e2e:
	@echo "🎭 Running E2E tests..."
	pnpm e2e

# Run performance / Lighthouse tests (local only — never in CI)
perf:
	@echo "🚀 Running performance tests..."
	pnpm perf

# Scan for secrets
secret-scan:
	@if command -v gitleaks > /dev/null; then \
		gitleaks dir .; \
	else \
		echo "❌ gitleaks not found. Install: https://github.com/gitleaks/gitleaks#installing"; \
		exit 1; \
	fi

# Lint GitHub Actions workflows (local only — never in CI)
actionlint:
	@if command -v actionlint > /dev/null; then \
		actionlint; \
	else \
		echo "❌ actionlint not found. Install: brew install actionlint"; \
		exit 1; \
	fi

# Deploy to Cloudflare Workers
deploy:
	@echo "☁️ Deploying to Cloudflare..."
	pnpm deploy

# Composite gate: everything a PR must pass locally before pushing
ai-checks: format-check lint typecheck test actionlint

# Remove build artifacts and dependencies
clean:
	@echo "🧹 Cleaning up..."
	rm -rf node_modules dist coverage playwright-report test-results .wrangler
	@echo "✨ Clean complete."
