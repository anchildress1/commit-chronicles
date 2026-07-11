# Snowflake account bootstrap

One-off admin commands to recreate the local + account setup from scratch.
Not part of `snowflake/schema.sql` or `snowflake/ingest_pipeline.sql` because
they're account-level, interactive, or secret-bearing — run manually, in
order, whenever the account or local machine changes.

Never put a real token/PAT value in this file. Reference `.env` instead.

## 1. Local CLI tooling

```bash
uv tool install snowflake-cli
```

## 2. Snowflake CLI connection

Requires a PAT scoped to a role that owns `CHRONICLES` (`ACCOUNTADMIN` works;
see step 4 for why role choice matters). Reads the token and account
identifier from `.env` (`SNOWFLAKE_PAT`, `SNOWFLAKE_ACCOUNT`) rather than
typing them inline.

```bash
set -a; source .env; set +a
snow connection add \
  --connection-name commit-chronicles \
  --account "$SNOWFLAKE_ACCOUNT" \
  --user anchildress1 \
  --password "$SNOWFLAKE_PAT" \
  --warehouse CHRONICLES_WH \
  --database CHRONICLES \
  --schema RAW \
  --default \
  --no-interactive
```

Written to `~/Library/Application Support/snowflake/config.toml` (macOS),
outside the repo.

## 3. Network policy (required for any PAT to authenticate at all)

Snowflake requires a user to be under a network policy before a PAT will
work. Run in Snowsight (not reachable via CLI — chicken-and-egg, the CLI
can't connect until this exists):

```sql
CREATE NETWORK POLICY commit_chronicles_dev
  ALLOWED_IP_LIST = ('0.0.0.0/0');   -- tighten to a real IP if you want

ALTER USER anchildress1 SET NETWORK_POLICY = commit_chronicles_dev;
```

## 4. PAT with the right role

PATs are role-locked at creation — no `USE ROLE` switching in that session
afterward. A PAT minted with the account default role (often `ORGADMIN`)
cannot run DDL against `CHRONICLES`. Mint one scoped to `ACCOUNTADMIN`:

```sql
ALTER USER anchildress1 ADD PROGRAMMATIC ACCESS TOKEN commit_chronicles_admin
  ROLE_RESTRICTION = 'ACCOUNTADMIN'
  DAYS_TO_EXPIRY = 90;
```

Shown once in the Snowsight results — copy it straight into `.env` as
`SNOWFLAKE_PAT`, don't paste it into chat.

## 5. GitHub token secret (for `ingest_pipeline.sql`)

`.env` needs `GITHUB_TOKEN` set first. Creates the Snowflake `SECRET` object
that `snowflake/ingest_pipeline.sql` references by name — the literal value
never lands in a tracked file.

```bash
set -a; source .env; set +a
snow sql -q "USE ROLE ACCOUNTADMIN; USE SCHEMA CHRONICLES.RAW; \
  CREATE OR REPLACE SECRET GITHUB_TOKEN TYPE = GENERIC_STRING SECRET_STRING = '$GITHUB_TOKEN';"
```

## 6. Claude Code MCP registration (read-only Snowflake access for Claude)

Local scope only — stored in `~/.claude.json` under this project path, never
committed.

```bash
set -a; source .env; set +a
claude mcp add mcp-server-snowflake -s local \
  -e SNOWFLAKE_ACCOUNT="$SNOWFLAKE_ACCOUNT" \
  -e SNOWFLAKE_USER=anchildress1 \
  -e SNOWFLAKE_PASSWORD="$SNOWFLAKE_PAT" \
  -e SNOWFLAKE_WAREHOUSE=CHRONICLES_WH \
  -- uvx snowflake-labs-mcp --service-config-file ~/.mcp/tools_config.yaml
```

`~/.mcp/tools_config.yaml` (outside the repo, per-machine):

```yaml
agent_services: []
search_services: []
analyst_services: []
other_services:
  object_manager: True
  query_manager: True
  semantic_manager: True
sql_statement_permissions:
  - All: True
```
