-- Commit Chronicles — the Cortex read
--
-- The only part of the pipeline that costs money, so it runs on a cache miss and
-- nowhere else. Calls the registered CHRONICLE_CARD function from ai_functions.sql —
-- one Cortex round trip, returning the whole card as schema-constrained JSON.
--
-- What Cortex reads is rationed by the detector, not here: it sees the winning
-- storyline's ~20 commits and the computed facts, never the whole history. The scatter
-- plot below is handed straight to the renderer and never shown to a model at all.
--
-- Truncation gotcha, learned the hard way: a Cortex structured response that hits its
-- token ceiling comes back NULL rather than raising. A stingy budget looks exactly
-- like a model outage. A NULL narration is treated as a hard failure below.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- 1. The generated cards. One row per repo; Cloud Run reads this and renders.
CREATE OR REPLACE TABLE CARDS (
  REPO_OWNER      STRING       NOT NULL,
  REPO_NAME       STRING       NOT NULL,
  STORYLINE       STRING       NOT NULL,
  SCORE           NUMBER(3,0),
  STATUS          STRING,        -- observed, never narrated. See below.
  KICKER          STRING,
  HEADLINE_LEAD   STRING,        -- first clause, set upright
  HEADLINE_ACCENT STRING,        -- second clause, set italic and in ACCENT
  THESIS          STRING,
  ACCENT          STRING,        -- hex; Cortex picks it, the arc earns it
  ACCENT_REASON   STRING,
  FACTS           VARIANT,
  EVIDENCE        VARIANT,
  PLOT            VARIANT,       -- the full scatter — Cloud Run draws the beeswarm from this
  MODEL           STRING,
  CORTEX_QUERY_ID STRING,        -- cost audit; spec requires it
  GENERATED_AT    TIMESTAMP_TZ
);

-- 2. The scatter. Every clean commit as (date, hour, is_night) — the card's spine.
-- Unlike CARD_EVIDENCE this is the whole history: it is plotted, not narrated, so it
-- costs nothing to hand over in full. No AI function ever sees it.
CREATE OR REPLACE VIEW CARD_PLOT AS
SELECT
    c.REPO_OWNER,
    c.REPO_NAME,
    ARRAY_AGG(OBJECT_CONSTRUCT(
        'd', TO_VARCHAR(c.AUTHORED_DATE),
        'h', c.UTC_HOUR,
        'n', c.UTC_HOUR >= cfg.NIGHT_START_HOUR OR c.UTC_HOUR < cfg.NIGHT_END_HOUR
    )) WITHIN GROUP (ORDER BY c.AUTHORED_AT) AS PLOT
FROM COMMITS_CLEAN c
CROSS JOIN DETECTOR_CONFIG cfg
GROUP BY c.REPO_OWNER, c.REPO_NAME;

-- 3. Detector → the four Cortex functions → card payload.
CREATE OR REPLACE PROCEDURE READ_REPO(P_OWNER STRING, P_REPO STRING)
RETURNS VARIANT
LANGUAGE SQL
AS
$$
DECLARE
    hits   INTEGER DEFAULT 0;
    result VARIANT DEFAULT NULL;
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

    INSERT INTO CARDS (
        REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS,
        KICKER, HEADLINE_LEAD, HEADLINE_ACCENT, THESIS, ACCENT, ACCENT_REASON,
        FACTS, EVIDENCE, PLOT, MODEL, GENERATED_AT
    )
    WITH input AS (
        SELECT
            e.REPO_OWNER, e.REPO_NAME, e.STORYLINE, e.SCORE,
            e.FACTS, e.EVIDENCE, e.COMMITS, p.PLOT,
            -- Status is observed, not read. It falls out of the commit dates, so SQL
            -- decides it and the model is never given the chance to get it wrong.
            CASE
                WHEN e.FACTS:daysSinceLast::NUMBER >= 90 THEN 'abandoned'
                WHEN e.FACTS:daysSinceLast::NUMBER >= 30 THEN 'dormant'
                ELSE 'active'
            END AS STATUS,
            -- Every number spelled out and labelled in prose, rather than handed over as
            -- a JSON blob. Given {"commitCount":56,"nightCommits":47} the model wrote
            -- "fifty-six commits after midnight" — it grabbed an adjacent integer and
            -- captioned it wrong. Naming each number in the sentence it belongs to costs
            -- nothing and removes the failure mode.
            'This repository has ' || e.FACTS:commitCount::STRING || ' commits in total.'
            || ' Of those, ' || e.FACTS:nightCommits::STRING || ' were authored at night'
            || ' (22:00-04:59 UTC).'
            || ' ' || e.FACTS:aiAssistedCommits::STRING || ' carry an AI-assistance trailer.'
            || ' They were written by ' || e.FACTS:authorCount::STRING || ' author(s)'
            || ' across ' || e.FACTS:activeDays::STRING || ' active days,'
            || ' spanning ' || e.FACTS:spanDays::STRING || ' days'
            || ' from ' || e.FACTS:firstCommitAt::STRING
            || ' to ' || e.FACTS:lastCommitAt::STRING || '.'
            || ' The most recent commit was ' || e.FACTS:daysSinceLast::STRING || ' days ago.'
                AS FACT_SHEET
        FROM CARD_EVIDENCE e
        JOIN CARD_PLOT p USING (REPO_OWNER, REPO_NAME)
        WHERE e.REPO_OWNER = :P_OWNER AND e.REPO_NAME = :P_REPO
    ),
    -- One call. CHRONICLE_CARD returns the whole card as a schema-constrained JSON
    -- object, so there is nothing to parse and nothing to reconcile between calls.
    narrated AS (
        SELECT
            i.*,
            CHRONICLE_CARD(
                i.STORYLINE,
                i.STATUS,
                i.FACT_SHEET,
                TO_JSON(i.EVIDENCE),
                TO_JSON(i.COMMITS)
            ) AS CARD
        FROM input i
    )
    SELECT
        REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS,
        CARD:kicker::STRING,
        CARD:headline_lead::STRING,
        CARD:headline_accent::STRING,
        CARD:thesis::STRING,
        CARD:accent::STRING,
        CARD:accent_reason::STRING,
        FACTS, EVIDENCE, PLOT,
        'claude-sonnet-4-5',
        CURRENT_TIMESTAMP()
    FROM narrated;

    -- The INSERT is the query that ran Cortex, so its id is the one worth auditing.
    UPDATE CARDS
       SET CORTEX_QUERY_ID = LAST_QUERY_ID()
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    -- A NULL clause means a Cortex function returned nothing — almost always a
    -- truncated structured response. Fail loudly rather than caching a blank card.
    SELECT COUNT(*) INTO :hits
      FROM CARDS
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO
       AND (HEADLINE_LEAD IS NULL OR HEADLINE_ACCENT IS NULL
            OR THESIS IS NULL OR KICKER IS NULL OR ACCENT IS NULL);

    IF (hits > 0) THEN
        DELETE FROM CARDS WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;
        RETURN OBJECT_CONSTRUCT(
            'status',    'failed',
            'errorCode', 'cortex_empty',
            'repo',      :P_OWNER || '/' || :P_REPO
        );
    END IF;

    SELECT OBJECT_CONSTRUCT(
               'status',        'ready',
               'repo',          REPO_OWNER || '/' || REPO_NAME,
               'storyline',     STORYLINE,
               'score',         SCORE,
               'statusLabel',   STATUS,
               'kicker',        KICKER,
               'headlineLead',  HEADLINE_LEAD,
               'headlineAccent', HEADLINE_ACCENT,
               'thesis',        THESIS,
               'accent',        ACCENT,
               'accentReason',  ACCENT_REASON,
               'facts',         FACTS,
               'evidence',      EVIDENCE,
               'plot',          PLOT,
               'model',         MODEL,
               'cortexQueryId', CORTEX_QUERY_ID,
               'generatedAt',   TO_VARCHAR(GENERATED_AT)
           )
      INTO :result
      FROM CARDS
     WHERE REPO_OWNER = :P_OWNER AND REPO_NAME = :P_REPO;

    RETURN :result;
END;
$$;
