-- One-time setup for the commit ingestion pipeline. Run once per Snowflake
-- account/database (fresh environment) before the app issues any loads.

CREATE FILE FORMAT IF NOT EXISTS NDJSON_GZ
  TYPE = JSON
  COMPRESSION = GZIP
  STRIP_OUTER_ARRAY = FALSE
  MULTI_LINE = FALSE;

-- Internal stage: Cloud Run PUTs each generation's commits file here via the
-- Snowflake driver. No cross-cloud storage integration needed.
CREATE STAGE IF NOT EXISTS COMMIT_STAGE;

CREATE TABLE IF NOT EXISTS COMMITS (
  REPO STRING NOT NULL,
  SHA STRING NOT NULL,
  AUTHOR STRING,
  EMAIL STRING,
  SUBJECT STRING,
  BODY STRING,
  AUTHORED_AT TIMESTAMP_TZ,
  COMMITTED_AT TIMESTAMP_TZ,
  PARENT_COUNT NUMBER
)
CLUSTER BY (REPO);
