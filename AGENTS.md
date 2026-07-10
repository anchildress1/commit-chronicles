# AGENTS.md

Canonical instruction source for this repository. Treat this file as authoritative.

## Scope

- Apply these rules when changing code in this repo.
- If a local instruction file conflicts with this file, prefer this file.

## Non-Negotiable Constraints

- Goal is long-term maintainable and reliable solutions only.
- Do not implement quick fixes in this codebase for any reason.
- Any test files introduced for local validation must be removed, not committed.
- Prerelease changes are never a breaking change; do not add backwards-compat shims.

### Security: file access and path handling

- Reject any user-controlled path input containing `..`.
- Resolve to absolute paths before use.
- Enforce sandbox-root containment after resolution.
- Default to deny on validation failure.

### GitHub Actions: action pinning

- `actions/*` and `github/*` references may use tagged major versions (e.g., `@v7`).
- All other actions must be pinned to a commit SHA with the version in a comment
  (e.g., `@abc123 # v4.1.0`).
- Lighthouse / `lhci` never runs in CI — it lives only in the local `make perf` target.

### Commit format (when committing is requested)

- Use Conventional Commits.
- Every commit must be GPG-signed and atomic (one logical change).
- Never land directly on `main` — branch and PR always.
- Include the required RAI footer identifying the model:
  ```
  Generated-by: Claude Sonnet 5
  ```

## Project: Commit Chronicles

Paste a GitHub handle, get a card ranking your commit habits (volume, chronotype,
weekend ratio, streak, consistency, AI-attribution) as a population percentile over a
trailing 7-day window. Data comes from the Snowflake Marketplace "Cybersyn: GitHub
Events" share. See `docs/initial-design-spec.md` for the full product spec.

### Stack

- **Frontend**: Vite + React 19 SPA, TypeScript strict.
- **Backend**: a single Cloudflare Worker (Hono) that serves the built static assets
  and the `/api/*` routes — one deployable unit, one URL.
- **Build**: `@cloudflare/vite-plugin` drives one `vite build` producing both the
  client bundle and the Worker; `wrangler deploy` ships it.
- **Package manager**: pnpm (pinned via Volta). Node 22+.
- **Tests**: Vitest (unit) + Playwright (e2e).

### Layout

- `src/` — React SPA (`main.tsx`, `App.tsx`), unit tests colocated as `*.test.tsx`.
- `worker/` — Worker entrypoint + API routes, unit tests colocated as `*.test.ts`.
- `e2e/` — Playwright specs.
- `index.html` — Vite entry at repo root.

### Commands

Run everything through `make` (delegates to pnpm):

| Command                             | Description                                  |
| ----------------------------------- | -------------------------------------------- |
| `make install`                      | Install dependencies                         |
| `make dev`                          | Start the Vite dev server (client + Worker)  |
| `make format` / `make format-check` | Format / check formatting                    |
| `make lint`                         | ESLint                                       |
| `make typecheck`                    | `tsc --noEmit` across all project references |
| `make test`                         | Vitest unit tests with coverage              |
| `make e2e`                          | Playwright e2e tests                         |
| `make perf`                         | Local Lighthouse (never CI)                  |
| `make secret-scan`                  | gitleaks                                     |
| `make build`                        | Production build                             |
| `make deploy`                       | `wrangler deploy`                            |
| `make ai-checks`                    | format-check + lint + typecheck + test       |
| `make clean`                        | Remove build + dependency artifacts          |

## Test Standards

- **Coverage thresholds**: 85% lines/functions/statements, 80% branches (enforced in
  `vitest.config.ts`).
- Every new component or utility ships with positive, negative, and edge-case tests.

## TypeScript Strictness

- `strict: true` is enforced. Run `make typecheck` to verify.
- Do not weaken strict settings or add `// @ts-ignore` without a justifying comment.

## Application Logic (not yet built)

- Do not scaffold Snowflake SQL, percentile math, or card rendering until asked — the
  current app is a placeholder landing view plus a `/api/health` route.
- When metrics land: descriptive not causal, templated not LLM-freeform, and always
  filter the 7-day date window _before_ any window function (cost guard).

## Documentation

- Do not add docs to the project unless specifically asked.
