# Commit Chronicles

A contribution graph tells you that work happened. It never tells you what happened.

Paste a public GitHub repo. Snowflake reads its commit history, finds the one story
actually hiding in it — the project that went dark for 107 days and came back at 3:32am,
the repo built entirely after midnight whose last commit landed at 3:53 and never got
another — and renders it as a card you can drop into a README.

Plain SQL finds the story. Cortex narrates it, and picks the color it deserves.

```md
[![Commit Chronicle](https://commitchronicles.dev/owner/repo/card.svg)](https://commitchronicles.dev/owner/repo)
```

## How it works 🔧

```text
SPA  →  POST /api/generate  →  Cloud Tasks  →  /internal/generate
                                                     │
                                                     ▼
                                      Snowflake: CALL READ_REPO(owner, repo)
                                        ├─ ingest    external access → api.github.com
                                        ├─ detector  plain SQL → score storylines → pick ONE
                                        └─ cortex    narrate that one thread + pick the accent
                                                     │
                                            card payload (JSON)
                                                     ▼
                                      Cloud Run renders the SVG → public GCS bucket
```

- **Snowflake is the app.** It fetches its own data through an external access integration,
  finds the story with window functions, and shows Cortex only the winning thread — a
  quarter of the material, capped, never the whole history. Squash-merge bodies are split
  into line items first, so the work inside a merge is visible.
- **Cloud Run computes nothing.** It guards the request, calls one stored procedure, turns
  the returned payload into an SVG, and writes it to the bucket.
- **The bucket is the cache of record.** A card's existence in it _is_ the ready state.
  A cached page never re-runs Cortex.
- **Every colour on the card is Cortex's.** A repo that died and one that came back and
  shipped must not wear the same accent.

Generation runs through a queue so it survives you closing the tab, and so the service can
still scale to zero — see the architecture section of
[`docs/initial-design-spec.md`](docs/initial-design-spec.md) for why that is a cost
decision rather than a plumbing one.

## Development

```bash
make install     # deps + git hooks
make dev         # API on :8080, SPA on :5273
make ai-checks   # format, lint, typecheck, test, build — the full gate
```

Without a Cloud Tasks queue configured, generation runs in-process, so a laptop needs no
queue to work.

Copy `.env.example` to `.env` and fill it in — see
[`docs/snowflake-setup.md`](docs/snowflake-setup.md) for how to mint the Snowflake PAT and
the GitHub token.

## Deploying

```bash
make snowflake-deploy   # every warehouse object, in dependency order
make gcp-bootstrap      # bucket, image repo, service accounts, secret, queue (one-off)
make deploy             # build the image, deploy to Cloud Run, prune to 3 revisions
```

`SNOWFLAKE_PAT` lives in Secret Manager and is mounted at run time. `.env` is for local
development only; nothing in it is baked into an image.

## Docs

- [`docs/initial-design-spec.md`](docs/initial-design-spec.md) — the product spec, the card
  contract, and the split between what Cortex writes and what the renderer composes.
- [`docs/build-plan.md`](docs/build-plan.md) — delivery order.
- [`docs/snowflake-setup.md`](docs/snowflake-setup.md) — account bootstrap.

## License

[Polyform Shield 1.0.0](LICENSE)
