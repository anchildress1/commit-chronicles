-- Commit Chronicles — card generation. The only Cortex spend in the pipeline.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- Replaced, not altered: the card contract changed shape (three-slot headline, no
-- label_void, no caption — both are pure facts now composed by the renderer).
-- Existing rows must be regenerated.
CREATE OR REPLACE TABLE CARDS (
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

-- Full scatter for the renderer. Never sent to a model.
-- t is the exact timestamp string so the renderer can pin annotations by matching
-- against FACTS.firstCommitAt / pivotAt / FACTS.lastCommitAt without float math.
-- m is the minute: the card annotates exact times ("3:53 AM"), which an integer hour
-- cannot produce. Dot height is h + m/60.
CREATE OR REPLACE VIEW CARD_PLOT AS
SELECT
    c.REPO_OWNER,
    c.REPO_NAME,
    ARRAY_AGG(OBJECT_CONSTRUCT(
        't', TO_VARCHAR(c.AUTHORED_AT),
        'd', TO_VARCHAR(c.AUTHORED_DATE),
        'h', c.UTC_HOUR,
        'm', MINUTE(c.AUTHORED_AT),
        'n', c.UTC_HOUR >= cfg.NIGHT_START_HOUR OR c.UTC_HOUR < cfg.NIGHT_END_HOUR
    )) WITHIN GROUP (ORDER BY c.AUTHORED_AT) AS PLOT
FROM COMMITS_CLEAN c
CROSS JOIN DETECTOR_CONFIG cfg
GROUP BY c.REPO_OWNER, c.REPO_NAME;

-- Renderer inputs are derived, so they rebuild from the views without re-narrating.
-- Calling READ_REPO for this would re-bill every card in the gallery.
CREATE OR REPLACE PROCEDURE REFRESH_CARD_DATA()
RETURNS STRING
LANGUAGE SQL
AS
$$
BEGIN
    UPDATE CARDS c
       SET FACTS = w.FACTS,
           PLOT  = p.PLOT
      FROM REPO_STORYLINE w, CARD_PLOT p
     WHERE c.REPO_OWNER = w.REPO_OWNER AND c.REPO_NAME = w.REPO_NAME
       AND c.REPO_OWNER = p.REPO_OWNER AND c.REPO_NAME = p.REPO_NAME;
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE PROCEDURE READ_REPO(P_OWNER STRING, P_REPO STRING)
RETURNS VARIANT
LANGUAGE SQL
AS
$$
DECLARE
    hits      INTEGER DEFAULT 0;
    storyline STRING  DEFAULT NULL;
    result    VARIANT DEFAULT NULL;
BEGIN
    SELECT COUNT(*) INTO :hits
      FROM CARD_EVIDENCE
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    IF (hits = 0) THEN
        RETURN OBJECT_CONSTRUCT(
            'status',    'failed',
            'errorCode', 'no_commits',
            'repo',      :P_OWNER || '/' || :P_REPO
        );
    END IF;

    DELETE FROM CARDS
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    SELECT STORYLINE INTO :storyline
      FROM REPO_STORYLINE
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    -- No storyline, no Cortex call. Template card instead. Labels are empty strings so
    -- the renderer's default anchor text ("first commit \u00b7 <time>", etc.) is what
    -- shows; adding a tail on top of that would read as filler.
    IF (storyline = 'none') THEN
        INSERT INTO CARDS (
            REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS, PIVOT_AT,
            KICKER, HEADLINE_UPRIGHT, HEADLINE_ACCENT, HEADLINE_TRAIL,
            LABEL_FIRST, LABEL_PIVOT, LABEL_LAST,
            ACCENT, ACCENT_REASON,
            FACTS, EVIDENCE, PLOT, MODEL, GENERATED_AT
        )
        SELECT
            w.REPO_OWNER, w.REPO_NAME, 'none', 0,
            CASE
                WHEN w.FACTS:daysSinceLast::NUMBER >= 90 THEN 'abandoned'
                WHEN w.FACTS:daysSinceLast::NUMBER >= 30 THEN 'dormant'
                ELSE 'active'
            END,
            NULL,
            'no story here',
            w.FACTS:commitCount::STRING || ' commits. They do not add up to',
            'anything',
            '.',
            '',
            '',
            '',
            '#6b7280',
            'grey, for a history with nothing to say',
            w.FACTS,
            OBJECT_CONSTRUCT(),
            p.PLOT,
            'none',
            CURRENT_TIMESTAMP()
        FROM REPO_STORYLINE w
        JOIN CARD_PLOT p USING (REPO_OWNER, REPO_NAME)
        WHERE w.REPO_OWNER = :P_OWNER AND w.REPO_NAME = :P_REPO;

        SELECT OBJECT_CONSTRUCT(
                   'status',          'ready',
                   'repo',            REPO_OWNER || '/' || REPO_NAME,
                   'storyline',       STORYLINE,
                   'statusLabel',     STATUS,
                   'kicker',          KICKER,
                   'headlineUpright', HEADLINE_UPRIGHT,
                   'headlineAccent',  HEADLINE_ACCENT,
                   'headlineTrail',   HEADLINE_TRAIL,
                   'labelFirst',      LABEL_FIRST,
                   'labelPivot',      LABEL_PIVOT,
                   'labelLast',       LABEL_LAST,
                   'accent',          ACCENT,
                   'accentReason',    ACCENT_REASON,
                   'pivotAt',         TO_VARCHAR(PIVOT_AT),
                   'facts',           FACTS,
                   'evidence',        EVIDENCE,
                   'plot',            PLOT,
                   'model',           MODEL,
                   'cortexQueryId',   NULL,
                   'generatedAt',     TO_VARCHAR(GENERATED_AT)
               )
          INTO :result
          FROM CARDS
         WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

        RETURN :result;
    END IF;

    INSERT INTO CARDS (
        REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS, PIVOT_AT,
        KICKER, HEADLINE_UPRIGHT, HEADLINE_ACCENT, HEADLINE_TRAIL,
        LABEL_FIRST, LABEL_PIVOT, LABEL_LAST,
        ACCENT, ACCENT_REASON,
        FACTS, EVIDENCE, PLOT, MODEL, GENERATED_AT
    )
    WITH input AS (
        SELECT
            e.REPO_OWNER, e.REPO_NAME, e.STORYLINE, e.SCORE, e.PIVOT_AT,
            e.FACTS, e.EVIDENCE, e.COMMITS, p.PLOT,
            CASE
                WHEN e.FACTS:daysSinceLast::NUMBER >= 90 THEN 'abandoned'
                WHEN e.FACTS:daysSinceLast::NUMBER >= 30 THEN 'dormant'
                ELSE 'active'
            END AS STATUS
        FROM CARD_EVIDENCE e
        JOIN CARD_PLOT p USING (REPO_OWNER, REPO_NAME)
        WHERE e.REPO_OWNER = :P_OWNER AND e.REPO_NAME = :P_REPO
    ),
    narrated AS (
        SELECT
            i.*,
            CHRONICLE_CARD(
                i.STORYLINE,
                i.STATUS,
                i.FACTS:commitCount::STRING,
                i.FACTS:nightCommits::STRING,
                i.FACTS:aiAssistedCommits::STRING,
                i.FACTS:authorCount::STRING,
                i.FACTS:activeDays::STRING,
                i.FACTS:spanDays::STRING,
                i.FACTS:daysSinceLast::STRING,
                i.FACTS:firstCommitAt::STRING,
                i.FACTS:firstCommitSubject::STRING,
                i.FACTS:lastCommitAt::STRING,
                i.FACTS:lastCommitSubject::STRING,
                TO_VARCHAR(i.PIVOT_AT),
                i.FACTS:largestGap:days::STRING,
                i.FACTS:largestGap:from::STRING,
                i.FACTS:largestGap:to::STRING,
                TO_JSON(i.EVIDENCE),
                TO_JSON(i.COMMITS)
            ) AS CARD
        FROM input i
    )
    SELECT
        REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS, PIVOT_AT,
        CARD:kicker::STRING,
        CARD:headline_upright::STRING,
        CARD:headline_accent::STRING,
        CARD:headline_trail::STRING,
        CARD:label_first::STRING,
        CARD:label_pivot::STRING,
        CARD:label_last::STRING,
        CARD:accent::STRING,
        CARD:accent_reason::STRING,
        FACTS, EVIDENCE, PLOT,
        'claude-sonnet-4-5',
        CURRENT_TIMESTAMP()
    FROM narrated;

    UPDATE CARDS
       SET CORTEX_QUERY_ID = LAST_QUERY_ID()
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    -- A structured Cortex response that hits max_tokens returns NULL, not an error.
    -- Empty-string labels are legal (label_last is "" unless active); NULL is the
    -- signal that the constrained decode failed.
    SELECT COUNT(*) INTO :hits
      FROM CARDS
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO
       AND (KICKER IS NULL OR HEADLINE_UPRIGHT IS NULL OR HEADLINE_ACCENT IS NULL
            OR HEADLINE_TRAIL IS NULL OR ACCENT IS NULL);

    IF (hits > 0) THEN
        DELETE FROM CARDS WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;
        RETURN OBJECT_CONSTRUCT(
            'status',    'failed',
            'errorCode', 'cortex_empty',
            'repo',      :P_OWNER || '/' || :P_REPO
        );
    END IF;

    SELECT OBJECT_CONSTRUCT(
               'status',          'ready',
               'repo',            REPO_OWNER || '/' || REPO_NAME,
               'storyline',       STORYLINE,
               'score',           SCORE,
               'statusLabel',     STATUS,
               'kicker',          KICKER,
               'headlineUpright', HEADLINE_UPRIGHT,
               'headlineAccent',  HEADLINE_ACCENT,
               'headlineTrail',   HEADLINE_TRAIL,
               'labelFirst',      LABEL_FIRST,
               'labelPivot',      LABEL_PIVOT,
               'labelLast',       LABEL_LAST,
               'accent',          ACCENT,
               'accentReason',    ACCENT_REASON,
               'pivotAt',         TO_VARCHAR(PIVOT_AT),
               'facts',           FACTS,
               'evidence',        EVIDENCE,
               'plot',            PLOT,
               'model',           MODEL,
               'cortexQueryId',   CORTEX_QUERY_ID,
               'generatedAt',     TO_VARCHAR(GENERATED_AT)
           )
      INTO :result
      FROM CARDS
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    RETURN :result;
END;
$$;
