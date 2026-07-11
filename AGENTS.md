# AGENTS.md

Canonical instruction source for this repository. Treat this file as authoritative.

## Scope

- Apply these rules when changing code in this repo.
- If a local instruction file conflicts with this file, prefer this file.

## Non-Negotiable Constraints

- Goal is long-term maintainable and reliable solutions only.
- Do not implement quick fixes in this codebase for any reason.
- Throwaway scripts or scratch files used for local validation must be removed,
  not committed — this does not apply to the project's actual test suite.
- Prerelease changes are never a breaking change; do not add backwards-compat shims.
- Do not run audible completion commands such as `say`; completion belongs in chat,
  not in a tool transcript. Tiny robot confetti is still confetti.

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
- Include the required RAI footer identifying the model, plus a human sign-off
  trailer (commitlint enforces both — use `git commit -s` to add the latter):
  ```
  Generated-by: Claude Sonnet 5 <noreply@anthropic.com>
  Signed-off-by: Your Name <your.email@example.com>
  ```

## Project: Commit Chronicles

Paste a public GitHub repo (`owner/repo`), start a generation job, wait or come back
later, then get a shareable commit story card plus a copyable README embed. GitHub
commit data for that repo is fetched by the API layer, processed through Snowflake
Cortex AISQL, and cached in Firestore. See `docs/initial-design-spec.md` for the full
product spec.

### Stack

- **Backend**: Cloud Run service for `/api/*` generation endpoints.
- **Hosting/cache**: Firebase Hosting for the embed and Firestore for generated
  chronicle documents.
- **AI/data engine**: Snowflake Cortex AISQL (`AI_CLASSIFY`, `AI_FILTER`, `AI_AGG`)
  used only on generation misses.

## Test Standards

- Every new component or utility ships with positive, negative, and edge-case tests.

## TypeScript Strictness

- Do not weaken strict settings or add `// @ts-ignore` without a justifying comment.

## Application Logic

- User flow is repo-first: enter a public `owner/repo`, submit once, and create or
  resume a Firestore-backed generation record at `repoCards/{ownerRepoKey}`.
- Generation continues after submission even if the user leaves the page.
- Returning to `/{owner}/{repo}` must attach to the existing Firestore record and show
  `generating`, `ready`, or `failed` state.
- The serving path reads Firestore only. Snowflake and GitHub are never called on a
  normal render of a cached repo page or card.
- Cloud Run is the only writer of generation status and final payload to Firestore;
  client writes are forbidden.
- Cortex output must be descriptive and fact-constrained. Do not infer motivation.
- Cost guards are mandatory: cap commits per repo, cap daily live generations, cache
  failed states, reject private/missing/oversized repos, and keep gallery records
  pre-generated.

## Documentation

- Do not create unsolicited documentation. Updating existing docs when asked
  (this file, the spec, READMEs) is expected, not exempted.
