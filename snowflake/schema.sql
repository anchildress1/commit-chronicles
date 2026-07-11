-- Commit Chronicles — warehouse, database, COMMITS table, detector input view.

USE ROLE ACCOUNTADMIN;

CREATE WAREHOUSE IF NOT EXISTS CHRONICLES_WH
  WAREHOUSE_SIZE      = 'XSMALL'
  AUTO_SUSPEND        = 60
  AUTO_RESUME         = TRUE
  INITIALLY_SUSPENDED = TRUE
  MAX_CLUSTER_COUNT   = 1
  STATEMENT_TIMEOUT_IN_SECONDS = 300;

USE WAREHOUSE CHRONICLES_WH;

CREATE DATABASE IF NOT EXISTS CHRONICLES;
CREATE SCHEMA IF NOT EXISTS CHRONICLES.RAW;
USE SCHEMA CHRONICLES.RAW;

CREATE TABLE IF NOT EXISTS COMMITS (
  REPO_OWNER     STRING       NOT NULL,
  REPO_NAME      STRING       NOT NULL,
  SHA            STRING       NOT NULL,
  AUTHOR         STRING,                  -- git display name
  AUTHOR_LOGIN   STRING,                  -- GitHub handle; the card credits @login, not a name
  EMAIL          STRING,
  SUBJECT        STRING,
  BODY           STRING,
  AUTHORED_AT    TIMESTAMP_TZ NOT NULL,   -- normalized to UTC by GitHub; local offset is lost
  COMMITTED_AT   TIMESTAMP_TZ,
  PARENT_COUNT   NUMBER(2,0),             -- >1 = merge
  IS_BOT         BOOLEAN      DEFAULT FALSE,
  IS_AI_ASSISTED BOOLEAN      DEFAULT FALSE
);
ALTER TABLE COMMITS ADD COLUMN IF NOT EXISTS AUTHOR_LOGIN STRING;

-- Lives here, not in read_repo.sql: a CREATE OR REPLACE there dropped every generated
-- card on each deploy of the procedure. The gallery is meant to be pre-generated, and
-- regenerating it costs a Cortex call per card. Change the card contract and you drop
-- this table by hand, on purpose.
CREATE TABLE IF NOT EXISTS CARDS (
  REPO_OWNER       STRING       NOT NULL,
  REPO_NAME        STRING       NOT NULL,
  STORYLINE        STRING       NOT NULL,
  SCORE            NUMBER(3,0),
  STATUS           STRING,
  PIVOT_AT         TIMESTAMP_TZ,
  KICKER           STRING,
  HEADLINE_UPRIGHT STRING,
  HEADLINE_ACCENT  STRING,
  HEADLINE_TRAIL   STRING,
  LABEL_FIRST      STRING,
  LABEL_PIVOT      STRING,
  LABEL_LAST       STRING,
  ACCENT           STRING,
  ACCENT_REASON    STRING,
  FACTS            VARIANT,
  EVIDENCE         VARIANT,
  PLOT             VARIANT,
  MODEL            STRING,
  CORTEX_QUERY_ID  STRING,
  GENERATED_AT     TIMESTAMP_TZ
);

-- An owner's-rights procedure cannot create a temporary table, so the ingest stages raw
-- rows here and classifies them in SQL, where AI_CLASSIFY and AI_FILTER live. Rows are
-- scoped by repo and deleted once classified; nothing is meant to survive a run.
CREATE TRANSIENT TABLE IF NOT EXISTS INGEST_STAGE (
  REPO_OWNER        STRING,
  REPO_NAME         STRING,
  SHA               STRING,
  AUTHOR            STRING,
  AUTHOR_LOGIN      STRING,
  GH_AUTHOR_TYPE    STRING,
  GH_COMMITTER_TYPE STRING,
  EMAIL             STRING,
  SUBJECT           STRING,
  BODY              STRING,
  AUTHORED_AT       STRING,
  COMMITTED_AT      STRING,
  PARENT_COUNT      NUMBER(2,0)
);

-- Hours are UTC, so the nocturne signal skews for non-UTC authors. Fixing it needs
-- author offsets from the Git Data API.
CREATE OR REPLACE VIEW COMMITS_CLEAN AS
SELECT
    REPO_OWNER, REPO_NAME, SHA, AUTHOR, AUTHOR_LOGIN, EMAIL, SUBJECT, BODY, AUTHORED_AT, IS_AI_ASSISTED,
    DATE(AUTHORED_AT)    AS AUTHORED_DATE,
    HOUR(AUTHORED_AT)    AS UTC_HOUR,
    DAYNAME(AUTHORED_AT) AS UTC_DOW
FROM COMMITS
WHERE PARENT_COUNT <= 1
  AND NOT IS_BOT
  -- Trailing .* required: Snowflake RLIKE anchors at both ends.
  AND SUBJECT NOT RLIKE '(Merge (pull request|branch|remote)|Bump |chore\\(deps\\)|Update dependenc).*';

