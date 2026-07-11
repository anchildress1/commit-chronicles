-- Runtime template. Cloud Run issues one of these per generation, not a
-- fixed migration. Substitute <STAGE_PATH> with a path unique to that
-- generation (e.g. @COMMIT_STAGE/{owner}/{repo}/{generationId}.ndjson.gz) —
-- reusing one fixed path across generations risks Snowflake's COPY INTO
-- load-history tracking skipping a re-PUT file at the same name.

COPY INTO COMMITS (REPO, SHA, AUTHOR, EMAIL, SUBJECT, BODY,
                    AUTHORED_AT, COMMITTED_AT, PARENT_COUNT)
FROM (
  SELECT
    $1:repo::STRING,
    $1:sha::STRING,
    $1:author::STRING,
    LOWER($1:email::STRING),
    $1:subject::STRING,
    $1:body::STRING,
    $1:authored_at::TIMESTAMP_TZ,
    $1:committed_at::TIMESTAMP_TZ,
    ARRAY_SIZE(SPLIT(NULLIF($1:parents::STRING, ''), ' '))
  FROM <STAGE_PATH> (FILE_FORMAT => NDJSON_GZ)
)
ON_ERROR = 'ABORT_STATEMENT'; -- one bad date kills the load, on purpose
