-- Commit Chronicles — GitHub ingest pipeline (Snowflake-native)
--
-- Deployed. GITHUB_TOKEN secret created separately — see docs/snowflake-setup.md
-- step 5. Never put the literal token value in this file.
--
-- Replaces the external PUT/COPY INTO loader in schema.sql: this pulls commits
-- for a given owner/repo directly from the GitHub REST API inside a Python
-- stored procedure, using an External Access Integration for egress.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- 1. Network egress: GitHub's REST API only.
CREATE OR REPLACE NETWORK RULE GITHUB_API_RULE
  MODE = EGRESS
  TYPE = HOST_PORT
  VALUE_LIST = ('api.github.com');

-- 2. Auth for authenticated requests (60 req/hr unauth vs 5000 req/hr auth).
-- GITHUB_TOKEN secret already exists (docs/snowflake-setup.md step 5).

CREATE OR REPLACE EXTERNAL ACCESS INTEGRATION GITHUB_API_ACCESS
  ALLOWED_NETWORK_RULES = (GITHUB_API_RULE)
  ALLOWED_AUTHENTICATION_SECRETS = (GITHUB_TOKEN)
  ENABLED = TRUE;

-- 3. Ingest procedure. owner/repo in, rows in COMMITS out.
--
-- MAX_COMMITS is clamped server-side (HARD_CAP below) regardless of what the
-- caller passes — spec requires a hard cap per repo, not just a suggestion.
CREATE OR REPLACE PROCEDURE INGEST_REPO_COMMITS(
  REPO_OWNER STRING,
  REPO_NAME STRING,
  MAX_COMMITS NUMBER DEFAULT 500
)
RETURNS VARIANT
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
PACKAGES = ('snowflake-snowpark-python', 'requests')
HANDLER = 'run'
EXTERNAL_ACCESS_INTEGRATIONS = (GITHUB_API_ACCESS)
SECRETS = ('github_token' = GITHUB_TOKEN)
AS
$$
import re
import requests
from snowflake.snowpark.functions import col

GITHUB_API = "https://api.github.com"
HARD_CAP = 2000
OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")

# Bot: automated non-human accounts (dependabot, renovate, CI). Signaled by
# GitHub's own linked-account type, falling back to name/email patterns for
# commits GitHub couldn't match to an account.
BOT_NAME_RE = re.compile(r"(?i)\[bot\]|dependabot|renovate|github-actions")
BOT_EMAIL_RE = re.compile(r"(?i)\[bot\]@|noreply@github\.com$")

# AI-assisted: a human committed it, but tooling left a trailer saying an AI
# model helped. Distinct from bot — a person can commit AI-assisted work, a
# bot's commits aren't "AI-assisted" just because they're automated.
AI_TRAILER_RE = re.compile(
    r"(?im)^(co-authored-by|generated-by|assisted-by|reviewed-by)\s*:.*"
    r"(claude|anthropic|copilot|chatgpt|gpt-4|gpt-5|codex|gemini|cursor|devin|openai)"
)


def _classify(commit_obj, gh_author, gh_committer, subject, body):
    git_author = commit_obj.get("author", {}) or {}
    name = git_author.get("name") or ""
    email = git_author.get("email") or ""

    is_bot = (
        (gh_author or {}).get("type") == "Bot"
        or (gh_committer or {}).get("type") == "Bot"
        or bool(BOT_NAME_RE.search(name))
        or bool(BOT_EMAIL_RE.search(email))
    )
    is_ai_assisted = bool(AI_TRAILER_RE.search(f"{subject}\n{body or ''}"))
    return is_bot, is_ai_assisted


def _auth_headers():
    headers = {"Accept": "application/vnd.github+json"}
    import _snowflake
    headers["Authorization"] = f"Bearer {_snowflake.get_generic_secret_string('github_token')}"
    return headers


def run(session, repo_owner, repo_name, max_commits):
    if not OWNER_RE.match(repo_owner or "") or not REPO_RE.match(repo_name or "") or ".." in repo_name:
        return {"status": "failed", "errorCode": "invalid_repo_slug"}

    repo_slug = f"{repo_owner}/{repo_name}"
    max_commits = max(1, min(int(max_commits or 500), HARD_CAP))
    headers = _auth_headers()

    repo_resp = requests.get(f"{GITHUB_API}/repos/{repo_slug}", headers=headers, timeout=10)
    if repo_resp.status_code == 404:
        return {"status": "failed", "errorCode": "repo_not_found", "repo": repo_slug}
    repo_resp.raise_for_status()
    if repo_resp.json().get("private"):
        return {"status": "failed", "errorCode": "repo_private", "repo": repo_slug}

    rows = []
    page = 1
    per_page = 100
    while len(rows) < max_commits:
        resp = requests.get(
            f"{GITHUB_API}/repos/{repo_slug}/commits",
            headers=headers,
            params={"per_page": per_page, "page": page},
            timeout=10,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for c in batch:
            commit = c.get("commit", {}) or {}
            author = commit.get("author", {}) or {}
            committer = commit.get("committer", {}) or {}
            message = commit.get("message", "") or ""
            subject, _, body = message.partition("\n")
            body = body.strip() or None
            is_bot, is_ai_assisted = _classify(
                commit, c.get("author"), c.get("committer"), subject.strip(), body
            )
            rows.append((
                repo_owner,
                repo_name,
                c.get("sha"),
                author.get("name"),
                (author.get("email") or "").lower() or None,
                subject.strip(),
                body,
                author.get("date"),
                committer.get("date"),
                len(c.get("parents", []) or []),
                is_bot,
                is_ai_assisted,
            ))
            if len(rows) >= max_commits:
                break
        page += 1

    if not rows:
        return {"status": "failed", "errorCode": "repo_empty", "repo": repo_slug}

    session.table("COMMITS").delete((col("REPO_OWNER") == repo_owner) & (col("REPO_NAME") == repo_name))
    session.create_dataframe(
        rows,
        schema=["REPO_OWNER", "REPO_NAME", "SHA", "AUTHOR", "EMAIL", "SUBJECT", "BODY",
                "AUTHORED_AT", "COMMITTED_AT", "PARENT_COUNT",
                "IS_BOT", "IS_AI_ASSISTED"],
    ).write.mode("append").save_as_table("COMMITS", column_order="name")

    return {"status": "ready", "repo": repo_slug, "commitCount": len(rows)}
$$;

-- 4. Smoke test once deployed — small, well-known public repo.
-- CALL INGEST_REPO_COMMITS('octocat', 'Hello-World', 50);
