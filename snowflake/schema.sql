-- Commit Chronicles — Snowflake setup
-- Model: claude-haiku-4-5 (gate passed 2026-07-11)

USE ROLE ACCOUNTADMIN;

-- 1. Warehouse
CREATE WAREHOUSE IF NOT EXISTS CHRONICLES_WH
  WAREHOUSE_SIZE      = 'XSMALL'
  AUTO_SUSPEND        = 60
  AUTO_RESUME         = TRUE
  INITIALLY_SUSPENDED = TRUE
  MAX_CLUSTER_COUNT   = 1
  STATEMENT_TIMEOUT_IN_SECONDS = 300;

USE WAREHOUSE CHRONICLES_WH;

-- 2. Database + schema
CREATE DATABASE IF NOT EXISTS CHRONICLES;
CREATE SCHEMA IF NOT EXISTS CHRONICLES.RAW;
USE SCHEMA CHRONICLES.RAW;

-- 3. File format + stage
CREATE OR REPLACE FILE FORMAT NDJSON_GZ
  TYPE = JSON
  COMPRESSION = GZIP
  STRIP_OUTER_ARRAY = FALSE;

CREATE STAGE IF NOT EXISTS COMMIT_STAGE FILE_FORMAT = NDJSON_GZ;

-- 4. The table. Typed at load, not at read.
CREATE TABLE IF NOT EXISTS COMMITS (
  REPO_OWNER     STRING       NOT NULL,
  REPO_NAME      STRING       NOT NULL,
  SHA            STRING       NOT NULL,
  AUTHOR         STRING,
  EMAIL          STRING,
  SUBJECT        STRING,
  BODY           STRING,
  AUTHORED_AT    TIMESTAMP_TZ NOT NULL,   -- author date; GitHub's REST API normalizes this to UTC,
                                           -- the original commit's local offset is not recoverable here
  COMMITTED_AT   TIMESTAMP_TZ,
  PARENT_COUNT   NUMBER(2,0),             -- >1 = merge
  IS_BOT         BOOLEAN      DEFAULT FALSE,  -- automated account (dependabot, CI), not a person
  IS_AI_ASSISTED BOOLEAN      DEFAULT FALSE   -- human commit naming an AI tool anywhere in the
                                              -- message. Not the same as IS_BOT.
);

-- Migrate the old combined REPO ('owner/name') column into REPO_OWNER/REPO_NAME.
-- True no-op on a fresh table: the UPDATE only runs if REPO actually exists,
-- since referencing a missing column in a plain UPDATE is a compile error,
-- not a silently-skipped no-op.
ALTER TABLE COMMITS ADD COLUMN IF NOT EXISTS REPO_OWNER STRING;
ALTER TABLE COMMITS ADD COLUMN IF NOT EXISTS REPO_NAME STRING;
EXECUTE IMMEDIATE $$
BEGIN
  LET repo_col_exists INTEGER := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'RAW' AND TABLE_NAME = 'COMMITS' AND COLUMN_NAME = 'REPO'
  );
  IF (repo_col_exists > 0) THEN
    UPDATE COMMITS SET
      REPO_OWNER = SPLIT_PART(REPO, '/', 1),
      REPO_NAME  = SPLIT_PART(REPO, '/', 2)
    WHERE REPO_OWNER IS NULL AND REPO IS NOT NULL;
  END IF;
  RETURN 'ok';
END;
$$;
ALTER TABLE COMMITS DROP COLUMN IF EXISTS REPO;
ALTER TABLE COMMITS ALTER COLUMN REPO_OWNER SET NOT NULL;
ALTER TABLE COMMITS ALTER COLUMN REPO_NAME SET NOT NULL;

-- 5. The detector's input. Filtering + derived time parts. No parsing.
-- UTC_HOUR/UTC_DOW, not local: GitHub's commits API returns author dates
-- normalized to UTC, so the nocturne/hour-of-day signal is systematically
-- wrong for non-UTC authors until ingestion pulls offsets from the Git Data
-- API instead. Known gap, not fixed here — see PR review discussion.
CREATE OR REPLACE VIEW COMMITS_CLEAN AS
SELECT
    REPO_OWNER, REPO_NAME, SHA, AUTHOR, EMAIL, SUBJECT, BODY, AUTHORED_AT, IS_AI_ASSISTED,
    DATE(AUTHORED_AT)    AS AUTHORED_DATE,
    HOUR(AUTHORED_AT)    AS UTC_HOUR,
    DAYNAME(AUTHORED_AT) AS UTC_DOW
FROM COMMITS
WHERE PARENT_COUNT <= 1                      -- merges are bookkeeping, not confession
  AND NOT IS_BOT                             -- flagged at ingestion, not guessed here
  -- Trailing .* is load-bearing: Snowflake's RLIKE implicitly anchors at BOTH
  -- ends, so a prefix pattern without it only matches a subject equal to the
  -- prefix and silently filters nothing.
  AND SUBJECT NOT RLIKE '(Merge (pull request|branch|remote)|Bump |chore\\(deps\\)|Update dependenc).*';

-- 6. Verify after first load.
SELECT REPO_OWNER, REPO_NAME,
       COUNT(*)               AS commits,
       MIN(AUTHORED_DATE)     AS first_commit,
       MAX(AUTHORED_DATE)     AS last_commit,
       COUNT(DISTINCT AUTHOR) AS authors
FROM COMMITS_CLEAN GROUP BY REPO_OWNER, REPO_NAME;
