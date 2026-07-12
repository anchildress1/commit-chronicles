# Commit Chronicles — Build Plan

Delivery order and what became of it. The product contract — architecture, the card, the detector, the Cortex call, the renderer/Cortex ownership split — lives in [`initial-design-spec.md`](initial-design-spec.md) and is not repeated here.

- **Prize:** Best Use of Snowflake — the app _is_ Snowflake.
- **Due:** Mon Jul 13, 06:59 UTC.
- **Deploy:** `make snowflake-deploy` — every object is SQL in the repo. An object created by clicking in a UI does not exist.

## Snowflake objects

| object                                              | status     |
| --------------------------------------------------- | ---------- |
| `GITHUB_API_RULE` (EGRESS, `api.github.com`)        | ✅ shipped |
| `GITHUB_TOKEN` (`SECRET`) — created out-of-band     | ✅ shipped |
| `GITHUB_API_ACCESS` (`EXTERNAL ACCESS INTEGRATION`) | ✅ shipped |
| `COMMITS` · `REPO_INGEST` · `INGEST_STAGE`          | ✅ shipped |
| `PROC INGEST_REPO_COMMITS(owner, repo)`             | ✅ shipped |
| `COMMITS_CLEAN` · `DETECTOR_CONFIG` (views)         | ✅ shipped |
| detector views (15) → `REPO_STORYLINE`              | ✅ shipped |
| `COMMIT_LINES` · `CARD_EVIDENCE` (views)            | ✅ shipped |
| `CHRONICLE_CARD` (UDF)                              | ✅ shipped |
| `CARD_PLOT` (view) · `CARDS`                        | ✅ shipped |
| `PIPELINE_VERSION` · `STALE_CARDS` (views)          | ✅ shipped |
| `CARD_PAYLOAD` (view) · `REFRESH_CARD_DATA()`       | ✅ shipped |
| `PROC READ_REPO(owner, repo)`                       | ✅ shipped |

No `STORAGE INTEGRATION` and no external stage — Cloud Run owns the bucket.

## Timeline (as delivered)

- **Fri night — THE GATE.** Two things proven before anything else was allowed to matter: external access can reach `api.github.com` from inside a proc, and Cortex AISQL runs in the region.
- **Sat AM** — ingest → `COMMITS`.
- **Sat PM** — detector SQL. It picked the intended storylines unaided.
- **Sun AM** — Cortex call via `READ_REPO`; Cloud Run renders the SVG → GCS.
- **Sun PM** — Cloud Run shell + `/api/generate`; card confirmed rendering in a real README.
- **Sun night** — writeup.
- **Mon early** — submit with buffer.

## Open items

- **Font rendering** — GitHub proxies README images through camo, so webfonts won't load. Fix is a base64-embedded subset. **Deferred by decision**; the card falls back through a serif stack.
- **Stale cards** — `STALE_CARDS` reports which cards a dead pipeline version wrote; it does not act, because acting costs a Cortex call each. `make cards-rerender` redraws stored cards for free — only a prompt change needs real spend.

## Cut

1. **The gallery page.** Three example chips on the landing page cover the same need.
2. Story types beyond the six — none were needed.

**Never cut, and wasn't:** external-access ingest · the detector SQL · the Cortex call including the palette pick · the SVG card.
