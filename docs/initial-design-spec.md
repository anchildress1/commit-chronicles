# Commit Chronicles — V1 Spec

*DEV Weekend Challenge: Passion Edition. Prize target: **Best use of Snowflake**. Due Mon Jul 13, 6:59 AM UTC.*

## Thesis

Commit Chronicles turns one public GitHub repository into a shareable commit story card. Paste a repo, generate the card, copy the image or README embed, and give the repo a small artifact that says what happened in its commit history.

The product is scoped to repositories because a whole-profile year-in-review is harder to track, harder to explain, and easier to turn into mush. A repo has a clearer arc: commits start, cluster, pause, restart, or stop.

## What ships (V1)

- A repository entry flow for public GitHub repos.
- A durable generation state: `generating`, `ready`, or `failed`.
- A generated social card image sized for README and social previews.
- A copyable Markdown README embed for the generated card.
- A cached public repo page at `/{owner}/{repo}`.
- A generated SVG card endpoint at `/{owner}/{repo}/card.svg`.
- A gallery of pre-generated repo cards for judge-safe demo coverage.

## User flow

1. User enters a GitHub repo URL or `owner/repo`.
2. Client normalizes the repo slug and subscribes to the Firestore card document.
3. If the document is `ready`, the app renders the cached card immediately.
4. If the document is missing or stale, the client calls the Cloud Run generation endpoint once.
5. Cloud Run writes `generating` to Firestore and starts the GitHub/Snowflake/Cortex pipeline.
6. The user can wait on the page or leave.
7. When generation finishes, Cloud Run writes the final `ready` payload to Firestore.
8. Returning later to `/{owner}/{repo}` reads the existing Firestore document and renders the result.
9. The user copies either the card image or the README Markdown embed.

The browser tab must not be required for generation to complete. If it is, the app is just a loading spinner wearing a trench coat.

## Product surface

The ready screen prioritizes the artifact:

- Repo address input, normalized as `commitchronicles.dev/{owner}/{repo}`.
- Status text such as `Your card is ready`.
- Large card preview.
- Primary action: `Copy card image`.
- Secondary action: `Copy README embed`.
- Markdown preview:
  ```md
  [![Commit Chronicle](https://commitchronicles.dev/{owner}/{repo}/card.svg)](https://commitchronicles.dev/{owner}/{repo})
  ```
- Link to read another repo.

## Card content

Each card should be readable as a standalone artifact:

- Product mark: `Commit Chronicles`.
- Repo slug.
- Short factual subtitle.
- Commit count.
- Status or observed pattern label.
- Main generated headline.
- Compact timeline or scatter plot from public commits.
- One short supporting sentence.
- Attribution line such as `Read by Snowflake Cortex`.

The tone can be editorial, but the claims must be grounded in observable commit data. Describe gaps, timestamps, bursts, reverts, commit types, and quiet periods. Do not infer intent, emotion, dedication, burnout, abandonment, or motivation unless the commit messages literally say it.

## Data source

Public GitHub commit data fetched by the API layer:

- Use GitHub APIs to validate the repo and fetch public commits.
- Ingest only public commit messages, commit SHA, authored timestamp, author login when public, and repo metadata needed for display.
- Cap commits before Snowflake work begins.
- Filter obvious bot or generated noise before costly Cortex calls when possible.

Do not use the Snowflake Marketplace archive for V1. The live product depends on user-submitted repos and Cortex output, not whole-population percentile math.

## Architecture

- **Firebase Hosting** serves the embed-friendly React SPA.
- **Firestore** is the cache of record and the serving database.
- **Cloud Run** owns generation endpoints and all privileged writes.
- **Snowflake Cortex AISQL** classifies, filters, and aggregates commit text during generation only.

```text
Browser
  -> Firestore subscribe repoCards/{ownerRepoKey}
  -> Cloud Run POST /api/generate on missing/stale doc

Cloud Run
  -> write generating doc
  -> fetch GitHub repo commits
  -> run Snowflake Cortex AISQL
  -> write ready or failed doc

Browser
  -> realtime update or later revisit
  -> render cached repo card
```

## Firestore cache

Document path:

```text
repoCards/{ownerRepoKey}
```

`ownerRepoKey` is derived from normalized lowercase `owner/repo` without allowing user-controlled path separators.

Minimum fields:

```ts
{
  owner: string;
  repo: string;
  repoSlug: string;
  status: 'generating' | 'ready' | 'failed';
  payload: RepoCardPayload | null;
  errorCode: string | null;
  requestedAt: Timestamp;
  updatedAt: Timestamp;
  generatedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  sourceWindow: { from: string; to: string };
  cost: {
    commitCount: number;
    cortexQueryIds: string[];
  };
}
```

Client reads may be public for launch because the underlying source is public repo commit data. Client writes are forbidden; only Cloud Run writes status and payload fields.

## Cortex pipeline

1. `AI_CLASSIFY` tags commit messages into categories such as feature, fix, refactor, docs, test, chore, and revert.
2. Plain SQL computes commit counts, active days, time-of-day patterns, quiet gaps, first/last commit, and type mix.
3. `AI_FILTER` identifies commits that describe reverts, hotfixes, breakage, or other narrative anchors.
4. `AI_AGG` generates constrained card copy from the classified and aggregated repo history.
5. SQL returns a structured payload for the card renderer.

Output is frozen into Firestore. Serving a shared repo page or card image never re-runs Cortex.

## Why it wins "Best use of Snowflake"

The Snowflake story is Cortex AISQL as the engine for turning unstructured commit messages into a compact public artifact:

- `AI_CLASSIFY` labels commit messages at row level.
- `AI_FILTER` acts as a semantic predicate for commits worth surfacing.
- `AI_AGG` reduces the repo's commit history into concise card copy.
- SQL computes the visible chart data and proof metrics.

The app should make the Snowflake proof visible without making the card feel like a dashboard. The writeup should show the SQL. Do not bury the expensive toy after buying it.

## Cost and abuse controls

- Snowflake and Cortex run only on cache miss or manual refresh.
- Firestore serves every cached page view and generated card request.
- Cloud Run owns generation and can finish after the user leaves.
- Cache failed states to prevent repeated expensive retries for bad repos.
- Reject duplicate generation while a recent `generating` record exists.
- Hard-cap live generations per day.
- Hard-cap commits per repo.
- Reject private, missing, empty, or oversized repos with clear failed states.
- Use the smallest viable Snowflake warehouse with auto-suspend and statement timeouts.
- Track Cortex query IDs in the Firestore document for cost audit.
- Pre-generate gallery repo cards.

## Known caveats

1. Public commit messages are uneven; quiet or merge-heavy repos may produce sparse cards.
2. The card is descriptive, not causal. It must not infer developer motivation.
3. Generation can take tens of seconds. That is acceptable because the result is durable and revisit-safe.
4. Sparse repos need a template fallback instead of forced Cortex prose.
5. README embeds need stable image rendering and cache headers, or the neat trick becomes a broken badge.

## Labels

Project **Commit Chronicles** · repo `commit-chronicles` · route `/{owner}/{repo}` · card endpoint `/{owner}/{repo}/card.svg` · generation endpoint `/api/generate`.
