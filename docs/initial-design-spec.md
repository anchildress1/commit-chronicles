# Commit Chronicles — V1 Spec

*DEV Weekend Challenge: Passion Edition. Prize target: **Best use of Snowflake**. Due Mon Jul 13, 6:59 AM UTC.*

## Thesis

A contribution graph tells you that work happened. It never tells you what happened. Buried in a repo's commit history is usually exactly one story worth telling — a project that went dark for 107 days and came back at 3:32am, a repo built entirely after midnight whose last commit landed at 3:53 and never got another, a week where every commit was a revert.

Commit Chronicles finds that one story with SQL, narrates it with Cortex, and renders it as a card you can paste into a README.

Scope is **one repository**, not a whole profile. A profile year-in-review turns to mush; a repo has a clean arc — commits start, cluster, pause, restart, or stop.

**The product is the card. The site exists to make one.**

## What ships (V1)

- A repo entry flow for public GitHub repos (`owner/repo` or a URL).
- A durable generation state: `generating`, `ready`, `failed`.
- A generated SVG card sized for README and social previews.
- A copyable Markdown embed.
- A cached public page at `/{owner}/{repo}` and a card at `/{owner}/{repo}/card.svg`.
- A gallery of pre-generated cards for judge-safe demo coverage.

## The card

1200×630 SVG, readable as a standalone artifact.

- **Product mark** — `Commit Chronicles`.
- **Kicker** naming the genre — `the death of a side project`, `the one that came back`.
- **Headline** — Didone serif, the second clause italic and in the accent color.
- **The arc** — a beeswarm scatter: date across, hour of day down, rotated so night sits at the bottom of the frame. Daylight commits render hollow, night commits solid. Long quiet stretches render as a **void panel** you look straight through. The last commit is a single accent dot.
- **Status** — an observed label: `abandoned` (no commits in N days), `shipped 1.0.1`, `active`.
- **Counts** — commits, span.
- **Thesis line** — one sentence about the shape of the history.
- **Attribution** — `read by Snowflake Cortex`.

If the card would work equally well as a bar chart, it has failed.

## Voice rules

**Have an opinion.** A card that only describes is a report, and nobody shares a report. The whole product is the sentence that says what the shape *means* — "the commits got later and later, and then they stopped." Write that sentence.

- **Interpret the arc. Never invent the facts.** Every timestamp, count, gap, and quoted message is real and derived from the ingested commits. Read the shape freely; do not manufacture events.
- **Quote the commit messages.** They're the author's own words and they're the best material on the card. A repo that ends on `fix: rp my release please token readonly` at 3:53am tells you more than any adjective.
- **Editorial, dry, literary.** Short sentences. It can be unsparing without being cruel, and confident without being hyperbolic.
- No praise, no hype, no emoji, no exclamation marks. Restraint in tone; boldness in claim.
- If the history genuinely has no story, say that. Don't manufacture drama out of six commits.

## User flow

1. User enters a repo.
2. Client normalizes the slug; Cloud Run checks the bucket for an existing card.
3. `ready` (the card object exists) → render the cached card immediately.
4. Missing or stale → client calls `POST /api/generate` **once**.
5. Cloud Run marks the job `generating`, then invokes the Snowflake pipeline.
6. The user can wait or leave.
7. Snowflake returns the card payload; Cloud Run renders the SVG and writes it to the
   bucket (or records `failed`).
8. Returning to `/{owner}/{repo}` finds the existing card and renders it.
9. User copies the card image or the README embed.

The browser tab must not be required for generation to complete. If it is, the app is a loading spinner wearing a trench coat.

## Product surface (ready state)

- Repo address, normalized as `commitchronicles.dev/{owner}/{repo}`.
- Large card preview.
- Primary action: **Copy card image**.
- Secondary action: **Copy README embed**.
  ```md
  [![Commit Chronicle](https://commitchronicles.dev/{owner}/{repo}/card.svg)](https://commitchronicles.dev/{owner}/{repo})
  ```
- Link to read another repo.

## Data source

The GitHub REST **Commits API** — `/repos/{owner}/{repo}/commits`. Public repos only.

**Do not use the Activity Events API.** GitHub stripped commit summaries and counts from `PushEvent` payloads on 7 Oct 2025, which also guts every GH-Archive mirror of it. Commit text now survives only in the main REST API.

Ingest: commit message, SHA, authored timestamp, author login when public. Cap commits per repo. Filter obvious bot noise before anything expensive runs.

The Snowflake Marketplace archive is not used in V1. This product is about one submitted repo and its Cortex reading, not whole-population percentile math.

## Architecture

```text
Cloud Run  (static SPA + /api/generate — no analysis logic)
   │  POST /api/generate → CALL READ_REPO(owner, repo)
   ▼
Snowflake
   ├─ ingest proc   external access → api.github.com → COMMITS
   ├─ detector      plain SQL → score storylines → pick ONE
   └─ cortex        narrate that thread + choose the palette
   │
   │  ◄── card payload (JSON)
   ▼
Cloud Run  templates the SVG → writes gs://…/{owner}/{repo}/card.svg
   ▼
Public GCS bucket  (serving every cached page + card; the file's existence is the state)
```

- **Snowflake** reaches GitHub itself via an external access integration, finds the story in SQL, and narrates it with Cortex. The ingest layer is a stored procedure, not a service.
- **Cloud Run** owns the routes, calls one Snowflake proc, and turns the returned payload into an SVG. It fetches no commit data and computes no analysis.
- **The GCS bucket** is the cache of record. A cached page or card never re-runs Cortex.

**Rendering lives in Cloud Run, not Snowflake.** Templating an SVG string is a chore, not a demonstration of a data warehouse — and doing it in-warehouse would drag a `STORAGE INTEGRATION`, an external stage, and a Snowflake-minted service-account IAM grant onto the critical path to buy nothing. The Snowflake case rests on the ingest, the detector, and the Cortex call. Cloud Run writes to the bucket with ordinary GCP credentials.

Snowflake cannot serve an anonymous HTTP request — SPCS "public" endpoints are RBAC-gated and hand a browser a login page. Cloud Run serves the card.

## Snowflake objects

| object | job |
|---|---|
| `GITHUB_API_RULE` (EGRESS, `api.github.com`) | let the warehouse out |
| `GITHUB_TOKEN` (`SECRET`) | GitHub token |
| `GITHUB_API_ACCESS` (`EXTERNAL ACCESS INTEGRATION`) | binds rule + secret |
| `COMMITS` | owner, repo, sha, subject, body, authored_at, bot/AI flags |
| `COMMITS_CLEAN` (view) | drops merges and bots; derives date + hour parts |
| `PROC INGEST_REPO_COMMITS(owner, repo)` | Python + external access → Commits API → `COMMITS` |
| detector views | gaps, streaks, night share, storyline scores → `REPO_STORYLINE` |
| `CARD_EVIDENCE` (view) | the winning thread's ~20 commits — the only thing Cortex sees |
| `CHRONICLE_CARD` (AI function) | registered via `CREATE_AI_FUNCTION`; one structured call → the whole card |
| `CARDS` | the generated card payloads, plus the Cortex query id for cost audit |
| `PROC READ_REPO(owner, repo)` | detector → `CHRONICLE_CARD` → structured card payload |
| `TASK` | scheduled regeneration for the gallery |

Every object is SQL in the repo, deployed with the `snow` CLI. An object created by clicking in a UI does not exist.

## The detector (plain SQL, no LLM)

This is the core of the product and the core of the Snowflake case. Score every candidate storyline deterministically; keep the highest. Surveying a repo's whole history produces a report. Picking one story produces an argument.

| storyline | signal |
|---|---|
| **relapse** | `LAG` over commit dates — quiet ≥ N days, then resumed |
| **nocturne** | share of commits after 22:00 |
| **binge** | longest consecutive-day streak, or the heaviest single night |
| **collapse** | a spike, then permanent silence |
| **fight** | a cluster of reverts/hotfixes in a short window (regex — no AI needed) |
| **resurrection** | quiet, resumed, and shipped a release |

Apply floors — a storyline needs a minimum number of real commits so bot noise can't win. Scoring is deterministic: the same repo always yields the same story.

Cheap, explainable, and it means Cortex is only ever pointed at the part that matters.

## Cortex

One call, fed **only the winning storyline's evidence**: ~10–20 real commit messages plus the computed facts. Never the whole history — that's how you buy an expensive, unfocused paragraph.

```json
{
  "kicker": "the death of a side project",
  "headline": "Born in daylight. Its last commit landed at 3:53 in the morning.",
  "thesis": "The commits got later and later, and then they stopped.",
  "status": "abandoned",
  "accent": "#e2695e",
  "accent_reason": "ember — a repo that ran hot and went out"
}
```

**Cortex chooses the palette.** The accent is a reading of the arc, not a brand constant: a repo that went quiet and a repo that came back and shipped must not wear the same color.

Narration constraints: use only the supplied facts and invent nothing — then say what they mean (see Voice rules).

## Why it wins "Best use of Snowflake"

- Snowflake **reaches out and gets its own data** — external access integration, no ingestion service.
- Plain SQL — window functions, gaps, streaks, histograms — **finds the story**. The warehouse is the editor, not a bucket the LLM reads from.
- Cortex narrates the one thread and picks the palette.
- Cheap by construction: detection costs nothing; the LLM sees twenty commits, not twenty thousand.

Show the SQL in the writeup. Do not bury the expensive toy after buying it.

## Cost and abuse controls

- Detection is plain SQL. Cortex only ever sees the winning thread.
- Snowflake runs on cache miss or manual refresh only; the bucket serves everything else.
- Cloud Run scales to zero.
- Cap commits per repo; hard-cap daily generations.
- Cache `failed` states so a bad repo can't be retried into a bill.
- Reject duplicate generation while a recent `generating` record exists.
- Reject private, missing, empty, or oversized repos with clear failed states.
- Smallest viable warehouse, auto-suspend, statement timeouts.
- Track Cortex query IDs on the document for cost audit.
- Pre-generate gallery cards.

## Known caveats

1. GitHub proxies README images through camo, so webfonts will not load in the card. Fonts must be base64-embedded as a subset.
2. The beeswarm offsets commits horizontally to avoid overplotting. The hour is exact; the day is accurate to within the cluster width. Disclose it.
3. A quiet or merge-heavy repo may have no story. Say so plainly rather than manufacturing one — sparse repos get a template fallback, not forced Cortex prose.
4. Generation takes tens of seconds. Acceptable, because the result is durable and revisit-safe.
5. README embeds need stable image rendering and cache headers, or the neat trick becomes a broken badge.

## Labels

Project **Commit Chronicles** · repo `commit-chronicles` · route `/{owner}/{repo}` · card endpoint `/{owner}/{repo}/card.svg` · generation endpoint `/api/generate`.
