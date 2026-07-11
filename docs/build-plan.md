# Commit Chronicles — Build Plan

## TL;DR

- **What:** a shareable OG card that tells the one real story hiding in a developer's commit history. Drops into a README, embeds in a post.
- **Stack:** Snowflake does the work. A public **GCS bucket** holds the card. **Cloud Run** is a thin display shell — it serves the embeddable page and pushes the button.
- **Built with:** `snow` CLI (SQL objects scripted in-repo) + Snowflake MCP (so Claude writes and runs the DDL).
- **Prize:** Best Use of Snowflake — the app _is_ Snowflake.
- **Due:** Mon Jul 13, 06:59 UTC.

## Architecture

```
Cloud Run (static SPA + one route, no analysis)
   │  type owner/repo → POST /api/generate ──────────────┐
   │                                                     ▼
   │                                                Snowflake
   │                                                  ├─ ingest proc   external access → api.github.com → COMMITS
   │                                                  ├─ detector      plain SQL: gaps, streaks, hours → pick ONE thread
   │                                                  └─ cortex        narrates it + picks the palette (hex + mood)
   │                                                     │
   │  ◄── card payload (JSON) ────────────────────────────┘
   ▼
Cloud Run renders the SVG → writes it to the bucket
   ▼
public GCS bucket ──► README <img> · dev.to embed
```

Snowflake gets its own data, finds the story, and reads it. Cloud Run serves the page, calls one proc, and turns the payload into an SVG. **The card in the bucket is the state** — if the file exists, it's ready.

**Rendering is Cloud Run's job, not Snowflake's.** Templating an SVG proves nothing about a warehouse, and doing it in-warehouse would put a `STORAGE INTEGRATION`, an external stage, and a service-account IAM grant on the critical path for zero narrative gain. Cloud Run has to exist anyway; it writes to GCS with ordinary credentials.

## Tooling

- **Snowflake MCP (self-hosted, `Snowflake-Labs/mcp`)** — Cortex plus object management and SQL orchestration. This is what lets Claude create the network rule, secret, integration, procs, and task.
- **Snowflake connector (directory)** — Cortex Agents / Cortex Search. Retrieval only; good for querying, not for DDL.
- **`snow` CLI** — every object lives as SQL in the repo and deploys with one command. Reproducible, reviewable, and it's what the writeup screenshots.

## Snowflake objects (the whole app)

| object                                              | job                                                        | status                      |
| --------------------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| `GITHUB_API_RULE` (EGRESS, `api.github.com`)        | let the warehouse out                                      | ✅ deployed                 |
| `GITHUB_TOKEN` (`SECRET`)                           | GitHub token                                               | ✅ deployed                 |
| `GITHUB_API_ACCESS` (`EXTERNAL ACCESS INTEGRATION`) | binds rule + secret                                        | ✅ deployed                 |
| `COMMITS`                                           | owner, repo, sha, subject, body, authored_at, bot/AI flags | ✅ deployed                 |
| `PROC INGEST_REPO_COMMITS(owner, repo)`             | Python + external access → REST Commits API → `COMMITS`    | ✅ deployed                 |
| `COMMITS_CLEAN` (view)                              | drops merges + bots, derives date/hour parts               | ✅ deployed                 |
| detector views                                      | gaps, streaks, night share, drama scores → one winner      | 🔨 `snowflake/detector.sql` |
| `CARD_EVIDENCE` (view)                              | the winning thread's ~20 commits — all Cortex ever sees    | 🔨 `snowflake/detector.sql` |
| `PROC READ_REPO(owner, repo)`                       | ingest if cold → detector → Cortex → card payload JSON     | ✅ deployed                 |
| `TASK`                                              | scheduled regeneration                                     | ⬜ cuttable                 |

No `STORAGE INTEGRATION` and no external stage — Cloud Run owns the bucket.

## Stage 1 — the detector (plain SQL, no LLM, free)

Score candidate threads, pick the single most dramatic **true** one:

- **relapse** — `LAG` over commit dates: silent ≥N days, then resumed. _(rai-lint: 107 days dark, back at 3:32am)_
- **nocturne** — share of commits after 22:00. _(my-hermantic-agent: 85%)_
- **binge** — longest consecutive-day streak, or the heaviest single night.
- **collapse** — a spike, then permanent silence. _(the 3:53am ending)_
- **fight** — a revert/hotfix cluster (regex; no AI needed).
- **resurrection** — dead, returned, **and shipped a release**.

Floors (minimum real commits) keep bots and noise from winning. Deterministic — same handle, same story.

## Stage 2 — Cortex (one small call)

Feed **only the winning thread's evidence** — ~10–20 real commit messages plus the computed facts. It returns:

```json
{
  "kicker": "the death of a side project",
  "headline_upright": "Born in daylight. Last touched at",
  "headline_accent": "3:53 in the morning",
  "headline_trail": ".",
  "label_first": "it begins",
  "label_pivot": "",
  "label_last": "",
  "accent": "#e8a04a",
  "accent_reason": "amber, for a thing that burned out"
}
```

Nine keys, all the writing on the card. The italic run sits inside sentence 2 — `headline_upright` is upright, `headline_accent` is italic and in the accent colour, `headline_trail` is upright again. Empty labels for the anchors this storyline doesn't use (a collapse has no separate pivot; a non-active repo doesn't get a poetic label on the last commit).

**Cortex picks the palette.** One `accent` hex paints every accent-coloured element on the card — kicker slug, italic headline fragment, last-commit dot, arrow, void-panel rule, attribution bullet. A project that died and one that shipped must not wear the same colour.

**Renderer owns the facts.** Kicker slug prefix, header meta (`59 COMMITS · QUIET SINCE FEB 25`), first/last-commit anchor prefixes, void-panel text, caption, author handle — all composed from `FACTS`, `STATUS`, `PIVOT_AT`, and the `PLOT` array. See the Ownership section in `docs/initial-design-spec.md` for the full split.

## Stage 3 — the card

Cloud Run templates an SVG (1200×630) from the Cortex JSON plus the plotted commits, and writes it to the public GCS bucket.

**Design:**

- Didone headline in three slots — upright, italic accent fragment, upright · mono kicker naming the genre · status label (`abandoned` / `shipped 1.0.1`).
- **The arc is the card:** beeswarm scatter, date across and hour down, night at the bottom. Daylight commits hollow, night commits solid. The dead stretch is a **void panel** you look through. The final commit is one accent dot.
- Poetic tails pin to the anchors the storyline uses. The headline **interprets** — that's the point.

## Cost

Detection is free SQL. Cortex sees ~20 commits, not thousands. Cloud Run scales to zero. Storage is a bucket. Ballpark: **lunch money, once.**

## Timeline

- **Fri night — THE GATE.** MCP + `snow` CLI connected. Prove two things: external access can reach `api.github.com` from inside a proc, and Cortex AISQL runs in your region. Nothing else matters until both are green.
- **Sat AM** — `ingest_commits` → `COMMITS_RAW` for one handle.
- **Sat PM** — detector SQL. Confirm it picks `my-hermantic-agent` (nocturne/collapse) and `rai-lint` (resurrection) unaided.
- **Sun AM** — Cortex call (kicker, headline, anchor labels, accent) via `READ_REPO`; Cloud Run renders the SVG → GCS.
- **Sun PM** — Cloud Run shell + `/api/generate`; confirm the card renders in a real README and the page embeds in a dev.to draft.
- **Sun night** — writeup: the detector SQL, the Cortex call, the `snow` deploy. Cards are the demo.
- **Mon early** — submit with buffer.

## Open items

- **Font rendering in the SVG** — GitHub proxies README images through camo, so webfonts won't load. Fix is a base64-embedded subset. Deferred by decision.
- **Anonymous serving** — Snowflake will not answer an anonymous HTTP request (SPCS "public" endpoints are RBAC-gated; a browser gets a login page). The public GCS bucket is the answer.
- **Async generation** — a run takes ~20–40s. The page polls the bucket, so closing the tab doesn't kill it.

## Cut first if behind

1. The scheduled `TASK` (generate by hand).
2. Extra story types (ship `relapse` + `nocturne` only).
3. The gallery page.

**Never cut:** external-access ingest · the detector SQL · the Cortex call including the palette pick · the SVG card · the writeup showing the SQL.
