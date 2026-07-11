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
  REPO          STRING       NOT NULL,
  SHA           STRING       NOT NULL,
  AUTHOR        STRING,
  EMAIL         STRING,
  SUBJECT       STRING,
  BODY          STRING,
  AUTHORED_AT   TIMESTAMP_TZ NOT NULL,   -- keeps the committer's original UTC offset
  COMMITTED_AT  TIMESTAMP_TZ,
  PARENT_COUNT  NUMBER(2,0)              -- >1 = merge
);

-- 5. Load. PUT does not work in Snowsight — SnowSQL / Python connector / snow CLI.
--
-- DELETE FROM COMMITS WHERE REPO = 'owner/name';   -- reloading? do this first
--
-- PUT file:///tmp/commits.ndjson.gz @COMMIT_STAGE AUTO_COMPRESS=FALSE;
--
-- COPY INTO COMMITS (REPO, SHA, AUTHOR, EMAIL, SUBJECT, BODY,
--                    AUTHORED_AT, COMMITTED_AT, PARENT_COUNT)
-- FROM (
--   SELECT
--     $1:repo::STRING,
--     $1:sha::STRING,
--     $1:author::STRING,
--     LOWER($1:email::STRING),
--     $1:subject::STRING,
--     $1:body::STRING,
--     $1:authored_at::TIMESTAMP_TZ,
--     $1:committed_at::TIMESTAMP_TZ,
--     ARRAY_SIZE(SPLIT(NULLIF($1:parents::STRING, ''), ' '))
--   FROM @COMMIT_STAGE/commits.ndjson.gz (FILE_FORMAT => NDJSON_GZ)
-- )
-- ON_ERROR = 'ABORT_STATEMENT';   -- one bad date kills the load, on purpose

-- 6. The detector's input. Filtering + derived time parts. No parsing.
CREATE OR REPLACE VIEW COMMITS_CLEAN AS
SELECT
    REPO, SHA, AUTHOR, EMAIL, SUBJECT, BODY, AUTHORED_AT,
    DATE(AUTHORED_AT)    AS AUTHORED_DATE,
    HOUR(AUTHORED_AT)    AS LOCAL_HOUR,
    DAYNAME(AUTHORED_AT) AS LOCAL_DOW
FROM COMMITS
WHERE PARENT_COUNT <= 1                      -- merges are bookkeeping, not confession
  AND EMAIL   NOT ILIKE '%[bot]%'
  AND EMAIL   NOT ILIKE '%noreply@github.com'
  AND AUTHOR  NOT ILIKE '%dependabot%'
  AND AUTHOR  NOT ILIKE '%renovate%'
  AND AUTHOR  NOT ILIKE '%github-actions%'
  AND SUBJECT NOT RLIKE '^(Merge (pull request|branch|remote)|Bump |chore\\(deps\\)|Update dependenc)';

-- 7. Verify after first load.
SELECT REPO,
       COUNT(*)               AS commits,
       MIN(AUTHORED_DATE)     AS first_commit,
       MAX(AUTHORED_DATE)     AS last_commit,
       COUNT(DISTINCT AUTHOR) AS authors
FROM COMMITS_CLEAN GROUP BY REPO;
