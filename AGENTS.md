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
- The RAI footer names the model that **wrote the diff**, not the one committing it.
  Reviewing, deploying, or verifying another agent's work is not authorship. When
  committing a diff authored elsewhere (e.g. Cortex Code), credit that model. If it
  isn't recorded anywhere, ask — never guess, and never default to yourself.

## Project: Commit Chronicles

Paste a public GitHub repo (`owner/repo`), start a generation job, wait or come back
later, then get a shareable commit story card plus a copyable README embed. Snowflake
fetches the repo's commits itself, finds the single most dramatic true storyline with
plain SQL, and narrates that one thread with Cortex. See `docs/initial-design-spec.md`
for the full product spec and `docs/build-plan.md` for the delivery order.

### Stack

- **Data + AI engine**: Snowflake does the work. An external access integration
  reaches `api.github.com` from inside a stored procedure; plain SQL views score the
  storylines; and `CHRONICLE_CARD` — a hand-written SQL UDF wrapping `AI_COMPLETE` —
  narrates the winner and picks the accent color in one schema-constrained call.

  Do not build it with Cortex AI Function Studio. The Studio registers functions through
  `SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION`, which Snowflake documents as internal, not to be
  called directly, and subject to change without notice; its supported entry points are a
  Snowsight wizard and the Cortex Code CLI, neither of which leaves the function in this
  repo. It emits an ordinary UDF around `AI_COMPLETE` anyway, so we write that ourselves.
- **Backend**: Cloud Run — `/api/generate`, plus serving `/{owner}/{repo}` and
  `/{owner}/{repo}/card.svg`. It renders the SVG from Snowflake's card payload and
  writes it to the bucket. It computes no analysis of its own.
- **Cache of record**: a public GCS bucket. The card's existence in the bucket *is*
  the ready state.

There is no Firestore and no Firebase Hosting. Both were dropped in the Snowflake-native
rescaffold; if you find a reference to either, it is stale — fix it.

## Test Standards

- Every new component or utility ships with positive, negative, and edge-case tests.

## TypeScript Strictness

- Do not weaken strict settings or add `// @ts-ignore` without a justifying comment.

## Application Logic

- User flow is repo-first: enter a public `owner/repo`, submit once, and create or
  resume a generation job keyed by `{owner}/{repo}`.
- Generation continues after submission even if the user leaves the page. If the
  browser tab is required for generation to finish, the app is a loading spinner
  wearing a trench coat.
- Returning to `/{owner}/{repo}` must attach to the existing job and show
  `generating`, `ready`, or `failed` state.
- The serving path reads the bucket only. Snowflake and GitHub are never called on a
  normal render of a cached repo page or card.
- Cloud Run is the only writer to the bucket; client writes are forbidden.
- The detector is plain SQL and picks exactly one storyline. Cortex is only ever shown
  the winning thread's evidence — never the whole history.
- Cortex interprets the *shape* of the history and must invent nothing. Every
  timestamp, count, gap, and quoted message on the card is real. Reading the arc is the
  product; asserting the author's motivation is not.
- A repo with no real story says so. Sparse histories get an honest template card, not
  manufactured drama.
- Cost guards are mandatory: cap commits per repo, cap daily live generations, cache
  failed states, reject private/missing/oversized repos, and keep gallery cards
  pre-generated.

## Documentation

- Do not create unsolicited documentation. Updating existing docs when asked
  (this file, the spec, READMEs) is expected, not exempted.
