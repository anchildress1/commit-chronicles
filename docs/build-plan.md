# Commit Chronicles — Build Plan

## TL;DR
- **What:** a shareable OG card that tells the one real story hiding in a developer's commit history. Drops into a README, embeds in a post.
- **Stack:** Snowflake does the work. A public **GCS bucket** holds the card. **Cloud Run** is a thin display shell — it serves the embeddable page and pushes the button.
- **Built with:** `snow` CLI (SQL objects scripted in-repo) + Snowflake MCP (so Claude writes and runs the DDL).
- **Prize:** Best Use of Snowflake — the app *is* Snowflake.
- **Due:** Mon Jul 13, 06:59 UTC.

## Architecture
```
Cloud Run (static SPA + one route, no logic)
   │  type a handle → POST /api/generate ───────────────┐
   │  poll the bucket for the card ◄───────────┐        │
   ▼                                           │        ▼
public GCS bucket ──► README <img>             │   Snowflake
                      dev.to embed             │     ├─ ingest proc   external access → api.github.com → COMMITS_RAW
                                               │     ├─ detector      plain SQL: gaps, streaks, hours → pick ONE thread
                                               │     ├─ cortex        narrates it + picks the palette (hex + mood)
                                               │     └─ card proc     renders SVG → writes to the GCS stage ─┘
```
Cloud Run serves the page, calls one Snowflake proc, and watches the bucket. It stores nothing and computes nothing. **The card in the bucket is the state** — if the file exists, it's ready.

## Tooling
- **Snowflake MCP (self-hosted, `Snowflake-Labs/mcp`)** — Cortex plus object management and SQL orchestration. This is what lets Claude create the network rule, secret, integration, procs, and task.
- **Snowflake connector (directory)** — Cortex Agents / Cortex Search. Retrieval only; good for querying, not for DDL.
- **`snow` CLI** — every object lives as SQL in the repo and deploys with one command. Reproducible, reviewable, and it's what the writeup screenshots.

## Snowflake objects (the whole app)
| object | job |
|---|---|
| `NETWORK RULE` (EGRESS, `api.github.com`) | let the warehouse out |
| `SECRET` | GitHub token |
| `EXTERNAL ACCESS INTEGRATION` | binds rule + secret |
| `STORAGE INTEGRATION` + `STAGE` (`gcs://…`) | where the card lands |
| `PROC ingest_commits(handle)` | Python + external access → REST Commits API → `COMMITS_RAW` |
| `COMMITS_RAW` | handle, repo, sha, message, authored_at |
| detector views | gaps, streaks, hour histogram, drama scores |
| `PROC render_card(handle, repo)` | SVG string → write to stage |
| `TASK` | scheduled regeneration |

## Stage 1 — the detector (plain SQL, no LLM, free)
Score candidate threads, pick the single most dramatic **true** one:
- **relapse** — `LAG` over commit dates: silent ≥N days, then resumed. *(rai-lint: 107 days dark, back at 3:32am)*
- **nocturne** — share of commits after 22:00. *(my-hermantic-agent: 85%)*
- **binge** — longest consecutive-day streak, or the heaviest single night.
- **collapse** — a spike, then permanent silence. *(the 3:53am ending)*
- **fight** — a revert/hotfix cluster (regex; no AI needed).
- **resurrection** — dead, returned, **and shipped a release**.

Floors (minimum real commits) keep bots and noise from winning. Deterministic — same handle, same story.

## Stage 2 — Cortex (one small call)
Feed **only the winning thread's evidence** — ~10–20 real commit messages plus the computed facts. It returns:
```json
{ "kicker": "the death of a side project",
  "headline": "Born in daylight. Died at 3:53 in the morning.",
  "thesis": "It didn't slow down. It got later, and later, and then it stopped.",
  "status": "abandoned",
  "accent": "#e2695e",
  "accent_reason": "ember, for a thing that burned out" }
```
**Cortex picks the palette.** The color is a judgment about the arc, not a brand constant — a project that died and one that shipped must not wear the same color.

## Stage 3 — the card
`render_card` templates an SVG (1200×630) from the Cortex JSON plus the plotted commits, and writes it to the GCS stage. The public bucket serves it.

**Design** — see `design-directive.md` and `mockup.html`:
- Didone headline with the italic half in the accent · mono kicker naming the genre · status label (`abandoned` / `shipped 1.0.1`).
- **The arc is the card:** beeswarm scatter, date across and hour down, night at the bottom. Daylight commits hollow, night commits solid. The dead stretch is a **void panel** you look through. The final commit is one accent dot.
- One thesis line at the foot. It **interprets** — that's the point.

## Cost
Detection is free SQL. Cortex sees ~20 commits, not thousands. Cloud Run scales to zero. Storage is a bucket. Ballpark: **lunch money, once.**

## Timeline
- **Fri night — THE GATE.** MCP + `snow` CLI connected. Prove two things: external access can reach `api.github.com` from inside a proc, and Cortex AISQL runs in your region. Nothing else matters until both are green.
- **Sat AM** — `ingest_commits` → `COMMITS_RAW` for one handle.
- **Sat PM** — detector SQL. Confirm it picks `my-hermantic-agent` (nocturne/collapse) and `rai-lint` (resurrection) unaided.
- **Sun AM** — Cortex call (headline, thesis, accent); `render_card` → SVG → GCS.
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
