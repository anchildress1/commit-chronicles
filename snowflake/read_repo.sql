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
    hits            INTEGER DEFAULT 0;
    storyline       STRING  DEFAULT NULL;
    result          VARIANT DEFAULT NULL;
    card            VARIANT DEFAULT NULL;
    cortex_query_id STRING  DEFAULT NULL;
    reasons         ARRAY   DEFAULT ARRAY_CONSTRUCT();
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

    -- Cortex path. Call CHRONICLE_CARD exactly once and capture the whole row into
    -- :card so the empty-response guard, the reject checks, and the INSERT all read the
    -- same values without re-billing the model. Repairs (label_pivot / label_last
    -- forced to '') are applied in the INSERT below because they are conditional on
    -- table-side facts, not free-form model output.
    SELECT
        OBJECT_CONSTRUCT(
            'storyline',   e.STORYLINE,
            'score',       e.SCORE,
            'status',      CASE
                               WHEN e.FACTS:daysSinceLast::NUMBER >= 90 THEN 'abandoned'
                               WHEN e.FACTS:daysSinceLast::NUMBER >= 30 THEN 'dormant'
                               ELSE 'active'
                           END,
            'pivotAt',     TO_VARCHAR(e.PIVOT_AT),
            'pivotEqLast', (e.PIVOT_AT IS NULL
                            OR e.PIVOT_AT = e.FACTS:lastCommitAt::TIMESTAMP_TZ),
            'facts',       e.FACTS,
            'evidence',    e.EVIDENCE,
            'plot',        p.PLOT,
            'ai',          CHRONICLE_CARD(
                               e.STORYLINE,
                               CASE
                                   WHEN e.FACTS:daysSinceLast::NUMBER >= 90 THEN 'abandoned'
                                   WHEN e.FACTS:daysSinceLast::NUMBER >= 30 THEN 'dormant'
                                   ELSE 'active'
                               END,
                               e.FACTS:commitCount::STRING,
                               e.FACTS:nightCommits::STRING,
                               e.FACTS:aiAssistedCommits::STRING,
                               e.FACTS:authorCount::STRING,
                               e.FACTS:activeDays::STRING,
                               e.FACTS:spanDays::STRING,
                               e.FACTS:daysSinceLast::STRING,
                               e.FACTS:firstCommitAt::STRING,
                               e.FACTS:firstCommitSubject::STRING,
                               e.FACTS:lastCommitAt::STRING,
                               e.FACTS:lastCommitSubject::STRING,
                               TO_VARCHAR(e.PIVOT_AT),
                               e.FACTS:largestGap:days::STRING,
                               e.FACTS:largestGap:from::STRING,
                               e.FACTS:largestGap:to::STRING,
                               TO_JSON(e.EVIDENCE),
                               TO_JSON(e.COMMITS)
                           )
        )
      INTO :card
      FROM CARD_EVIDENCE e
      JOIN CARD_PLOT p USING (REPO_OWNER, REPO_NAME)
     WHERE e.REPO_OWNER = :P_OWNER AND e.REPO_NAME = :P_REPO;

    SELECT LAST_QUERY_ID() INTO :cortex_query_id;

    -- Empty-response guard: constrained decode returns NULL when the model hits
    -- max_tokens or the schema rejects the draft.
    IF (:card:ai IS NULL
        OR :card:ai:kicker           IS NULL
        OR :card:ai:headline_upright IS NULL
        OR :card:ai:headline_accent  IS NULL
        OR :card:ai:headline_trail   IS NULL
        OR :card:ai:accent           IS NULL) THEN
        RETURN OBJECT_CONSTRUCT(
            'status',    'failed',
            'errorCode', 'cortex_empty',
            'repo',      :P_OWNER || '/' || :P_REPO
        );
    END IF;

    -- Reject guard: rules that SQL can check for free. Repairs (empty-when) are NOT
    -- rejects — they get applied in the INSERT. These are the cases where the model
    -- misbehaved badly enough that the card would misrender or lie: bad hex, over-
    -- length text that would break the frame, facts leaking into the poetic tails,
    -- kicker echoing the storyline keyword.
    SELECT ARRAY_COMPACT(ARRAY_CONSTRUCT(
        IFF(NOT REGEXP_LIKE(:card:ai:accent::STRING, '^#[0-9a-fA-F]{6}$'),
            'accent_hex_invalid', NULL),
        IFF(LENGTH(:card:ai:kicker::STRING)           > 40, 'kicker_too_long',           NULL),
        IFF(LENGTH(:card:ai:headline_upright::STRING) > 45, 'headline_upright_too_long', NULL),
        IFF(LENGTH(:card:ai:headline_accent::STRING)  > 55, 'headline_accent_too_long',  NULL),
        IFF(LENGTH(:card:ai:headline_trail::STRING)   > 5,  'headline_trail_too_long',   NULL),
        IFF(LENGTH(:card:ai:label_first::STRING)      > 30, 'label_first_too_long',      NULL),
        IFF(LENGTH(:card:ai:label_pivot::STRING)      > 30, 'label_pivot_too_long',      NULL),
        IFF(LENGTH(:card:ai:label_last::STRING)       > 30, 'label_last_too_long',       NULL),
        IFF(LENGTH(:card:ai:accent_reason::STRING)    > 60, 'accent_reason_too_long',    NULL),
        IFF(:card:ai:label_first::STRING RLIKE '.*[0-9].*', 'label_first_has_digits',  NULL),
        IFF(:card:ai:label_pivot::STRING RLIKE '.*[0-9].*', 'label_pivot_has_digits',  NULL),
        IFF(:card:ai:label_last::STRING  RLIKE '.*[0-9].*', 'label_last_has_digits',   NULL),
        IFF(LOWER(:card:ai:kicker::STRING) IN
                ('relapse','nocturne','binge','collapse','fight','resurrection'),
            'kicker_echoes_storyline', NULL)
    )) INTO :reasons;

    IF (ARRAY_SIZE(:reasons) > 0) THEN
        RETURN OBJECT_CONSTRUCT(
            'status',    'failed',
            'errorCode', 'cortex_rejected',
            'repo',      :P_OWNER || '/' || :P_REPO,
            'reasons',   :reasons,
            'received',  :card:ai
        );
    END IF;

    -- Card passes all guards. INSERT with the two conditional-empty repairs applied.
    INSERT INTO CARDS (
        REPO_OWNER, REPO_NAME, STORYLINE, SCORE, STATUS, PIVOT_AT,
        KICKER, HEADLINE_UPRIGHT, HEADLINE_ACCENT, HEADLINE_TRAIL,
        LABEL_FIRST, LABEL_PIVOT, LABEL_LAST,
        ACCENT, ACCENT_REASON,
        FACTS, EVIDENCE, PLOT, MODEL, CORTEX_QUERY_ID, GENERATED_AT
    )
    SELECT
        :P_OWNER,
        :P_REPO,
        :card:storyline::STRING,
        :card:score::NUMBER(3,0),
        :card:status::STRING,
        TO_TIMESTAMP_TZ(:card:pivotAt::STRING),
        :card:ai:kicker::STRING,
        :card:ai:headline_upright::STRING,
        :card:ai:headline_accent::STRING,
        :card:ai:headline_trail::STRING,
        :card:ai:label_first::STRING,
        IFF(:card:pivotEqLast::BOOLEAN, '', :card:ai:label_pivot::STRING),
        IFF(:card:status::STRING <> 'active', '', :card:ai:label_last::STRING),
        :card:ai:accent::STRING,
        :card:ai:accent_reason::STRING,
        :card:facts,
        :card:evidence,
        :card:plot,
        'claude-sonnet-4-5',
        :cortex_query_id,
        CURRENT_TIMESTAMP();

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
