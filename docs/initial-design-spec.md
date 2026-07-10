# Commit Chronicles — V1 Spec

*DEV Weekend Challenge: Passion Edition. Prize target: **Best use of Snowflake**. Due Mon Jul 13, 6:59 AM UTC.*

## Thesis

GitHub shows you your number. It never shows you your **rank**. Commit Chronicles ranks how obsessive your committing is against every public developer on GitHub. Paste your handle, get your card.

Not redundant: GitHub's profile already gives you the lifetime contribution graph. It never gives you *comparison* — where you sit against everyone. That gap is the product.

## What ships (V1)

Six "vs everyone" metrics, all over a **7-day window**, each returned as a population percentile:

- Volume (commits)
- Chronotype (late-night ratio)
- Weekend ratio
- Current streak
- Consistency (active days this week)
- AI-attributed % (commits carrying an AI co-author trailer)

Passion = volume + rhythm, not message sentiment.

## AI-attribution (deterministic)

A SQL regex on the commit message — no Python, no ML:

```sql
REGEXP_LIKE(commit_message,
  '(?i)co-authored-by:\s*(claude|github copilot|cursor|codex|devin|gemini)|generated with \[?claude', 's')
  AS is_ai_attributed
```

**Honesty rule:** high-precision, low-recall. Trailer present → definitely AI. Trailer absent → *not* definitely human. Label buckets **"AI-attributed" vs "unattributed,"** never "AI vs human."

## Data source

**Snowflake Marketplace → "Cybersyn: GitHub Events" (GZTSZAS2KJ3), free share.** All public GitHub events, ~17TB, auto-updated. Click "Get" → queryable table. No extraction, no storage cost (compute only).

## Architecture

- **No join.** Your commits are already rows in the share. Filter to a handle, rank against the population with a window function. Math + user input.
- **7-day window.** The date filter prunes 17TB down to a thin slice.
- **Guard:** date filter *before* the window function, always. A full-table window scan is the only way to burn credits.

## Cost & caching (how 17TB stays cheap + instant)

The unlock: **precompute the whole active population once**, not just demo handles.

- `user_week_metrics` — one row per user active in the trailing 7 days (all six metrics + percentiles). Built by **one** aggregation pass over the pruned slice (`CREATE TABLE AS SELECT`).
- A live lookup = **single-row `SELECT`** against that table → sub-second, ~$0 per visitor, no 17TB scan. The one scan already happened for everybody.
- Refresh weekly via a Snowflake `TASK`. For the submission, run it once and read the result.
- Dormant handle (no commits in 7 days) → not in table → graceful "no recent activity" state.

Guardrails: `RESOURCE MONITOR` capped ~5 credits (suspends on breach — surprise bill impossible), `XSMALL` warehouse, `AUTO_SUSPEND=60`, `INITIALLY_SUSPENDED=TRUE`, `STATEMENT_TIMEOUT=120`, result cache during dev. Realistic total: under $10.

## Live UX + infra

- Paste handle → instant card. This is what judges hit.
- Backend proxy holds Snowflake creds, calls the Snowflake SQL API. Host interchangeable (**Cloudflare Worker / GCP Cloud Run / Firebase** — pick by comfort; category-neutral). Default Cloudflare.
- **Static fallback (ship protection):** embed precomputed cards (Ashley, kid, a couple famous handles) in the submission post. If the live endpoint dies during judging, judges still see real results.

## Labels

Project **Commit Chronicles** · repo `commit-chronicles` · card title "Your Commit Chronicle" · routes `/api/card`, `/api/stats`.

## Why it wins "Best use of Snowflake"

Native Marketplace share + window functions + whole-population precompute is the on-brand "this is what Snowflake is for" story, and plays to the rubric's Writing + Creativity + Relevance.

## Known caveats (say them before the reader does)

1. Window-bounded → shows *recent* passion; a light committer shows thin. Scope, not bug.
2. AI-attribution recall — "unattributed" ≠ human.
3. Share freshness can lag the current day by hours.

## Later (explicitly NOT V1)

Lifetime "deep-dive" metrics (longest-ever streak, AI YoY, chronotype shift) + templated insight sentences — cached, gated, monitored. Two rules when built: descriptive not causal, templated not LLM-freeform. Also: Streamlit-in-Snowflake, Cortex over the public corpus. None of this ships first.
