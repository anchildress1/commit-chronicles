# Commit Chronicles

<!-- Banner image: add one at public/banner.png or docs/banner.png and uncomment below -->
<!-- ![Banner](./docs/banner.png) -->

[![CI](https://github.com/anchildress1/commit-chronicles/actions/workflows/ci.yml/badge.svg)](https://github.com/anchildress1/commit-chronicles/actions/workflows/ci.yml)
[![License: Polyform Shield](https://img.shields.io/badge/license-Polyform%20Shield-blue)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_commit-chronicles&metric=alert_status)](https://sonarcloud.io/project/overview?id=anchildress1_commit-chronicles)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_commit-chronicles&metric=coverage)](https://sonarcloud.io/project/overview?id=anchildress1_commit-chronicles)

GitHub shows you your number. It never shows you your rank.

Paste a GitHub handle, get a card ranking your commit habits — volume, chronotype,
weekend ratio, streaks, consistency, and AI-attribution — as a percentile against
every public GitHub developer, over a trailing 7-day window.

Full spec: [`docs/initial-design-spec.md`](docs/initial-design-spec.md).

> 🚧 Scaffold in progress — the landing view and a `/api/health` route are real; the
> ranking card and its Snowflake queries are next.

## Stack

- **Vite + React 19** SPA (TypeScript, strict mode)
- **One Cloudflare Worker** (Hono) serving both the static assets and the `/api/*`
  routes — single deployable unit, single URL, shipped with `wrangler deploy`
- **pnpm** (pinned via Volta), Node 22+
- **Vitest** (unit) + **Playwright** (e2e)

## Getting Started

```bash
# Install dependencies
make install

# Start the dev server (client + Worker together)
make dev
```

The dev server runs at `http://localhost:5173`. Hit `http://localhost:5173/api/health`
to confirm the Worker is alive.

## Available Commands

| Command             | Description                            |
| ------------------- | -------------------------------------- |
| `make install`      | Install all dependencies               |
| `make dev`          | Start the dev server (client + Worker) |
| `make format`       | Format the repo                        |
| `make format-check` | Check formatting (non-destructive)     |
| `make lint`         | Run ESLint                             |
| `make typecheck`    | TypeScript type check                  |
| `make test`         | Run unit tests with coverage           |
| `make build`        | Production build                       |
| `make e2e`          | Run Playwright e2e tests               |
| `make perf`         | Run local Lighthouse (never in CI)     |
| `make secret-scan`  | Scan for secrets with gitleaks         |
| `make deploy`       | Deploy to Cloudflare Workers           |
| `make ai-checks`    | format-check + lint + typecheck + test |
| `make clean`        | Remove build + dependency artifacts    |

## License

Released under the [Polyform Shield License 1.0.0](LICENSE). Source-available, not
open-source — read the license before you build a paid SaaS on top of it.

- **You can:** use it, fork it, learn from it, ship it inside your day job, hand it to a client.
- **You can't:** sell it, rebrand it, host it as paid SaaS, or otherwise monetize it without explicit written permission.
- **Public forks:** include the LICENSE file and credit the original work.
