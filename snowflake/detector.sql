-- Commit Chronicles — the detector
--
-- Plain SQL. No LLM, no cost. This is the part that finds the story: score every
-- candidate storyline deterministically, keep the highest, and hand Cortex only
-- the winning thread's evidence.
--
-- Regex notes, learned the hard way. Snowflake's engine:
--   * implicitly anchors at BOTH ends — a bare prefix pattern matches nothing, so
--     every pattern here carries an explicit .*
--   * rejects inline flags like (?i) — case-insensitivity is REGEXP_LIKE's 3rd arg
--   * does not honour \b word boundaries
--
-- Determinism caveat: COLLAPSE depends on DAYS_SINCE_LAST, measured against
-- CURRENT_TIMESTAMP. The same repo yields the same story on the same day; a repo
-- that crosses the abandonment threshold overnight will change. That is intended
-- — "abandoned" is a claim about now, not a fact about the past.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- 1. Tunables. One place, so tightening a floor is a diff and not a scavenger hunt.
CREATE OR REPLACE VIEW DETECTOR_CONFIG AS
SELECT
    15 AS MIN_COMMITS,           -- floor: below this a repo has no story worth telling
    30 AS RELAPSE_MIN_GAP_DAYS,  -- a gap shorter than this is a holiday, not a relapse
    90 AS ABANDONED_AFTER_DAYS,  -- silence this long reads as death, not a pause
     7 AS BINGE_MIN_STREAK_DAYS, -- a working week straight is the price of entry
     4 AS FIGHT_MIN_COMMITS,     -- reverts below this are a bad afternoon, not a war
    22 AS NIGHT_START_HOUR,      -- night = hour >= 22 ...
     5 AS NIGHT_END_HOUR;        -- ... or hour < 5

-- 2. Per-repo aggregate facts. Every storyline reads its floors from here.
CREATE OR REPLACE VIEW REPO_FACTS AS
SELECT
    c.REPO_OWNER,
    c.REPO_NAME,
    COUNT(*)                                        AS COMMIT_COUNT,
    COUNT(DISTINCT c.AUTHOR)                        AS AUTHOR_COUNT,
    COUNT(DISTINCT c.AUTHORED_DATE)                 AS ACTIVE_DAYS,
    MIN(c.AUTHORED_AT)                              AS FIRST_COMMIT_AT,
    MAX(c.AUTHORED_AT)                              AS LAST_COMMIT_AT,
    DATEDIFF(day, MIN(c.AUTHORED_AT), MAX(c.AUTHORED_AT))  AS SPAN_DAYS,
    DATEDIFF(day, MAX(c.AUTHORED_AT), CURRENT_TIMESTAMP()) AS DAYS_SINCE_LAST,
    SUM(IFF(c.UTC_HOUR >= cfg.NIGHT_START_HOUR
         OR c.UTC_HOUR <  cfg.NIGHT_END_HOUR, 1, 0))       AS NIGHT_COMMITS,
    SUM(IFF(c.IS_AI_ASSISTED, 1, 0))                AS AI_ASSISTED_COMMITS
FROM COMMITS_CLEAN c
CROSS JOIN DETECTOR_CONFIG cfg
GROUP BY c.REPO_OWNER, c.REPO_NAME;

-- 3. Gap between each commit and the one before it. The spine of relapse.
CREATE OR REPLACE VIEW COMMIT_GAPS AS
WITH lagged AS (
    SELECT
        REPO_OWNER, REPO_NAME, SHA, SUBJECT, AUTHORED_AT, UTC_HOUR,
        LAG(AUTHORED_AT) OVER (
            PARTITION BY REPO_OWNER, REPO_NAME ORDER BY AUTHORED_AT
        ) AS PREV_AT
    FROM COMMITS_CLEAN
)
SELECT
    REPO_OWNER, REPO_NAME, SHA, SUBJECT, AUTHORED_AT, UTC_HOUR, PREV_AT,
    DATEDIFF(day, PREV_AT, AUTHORED_AT) AS GAP_DAYS
FROM lagged
WHERE PREV_AT IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- The storylines. Each emits the same shape, in the same column order:
--   REPO_OWNER, REPO_NAME, STORYLINE, SCORE (0-100), PIVOT_AT, EVIDENCE
-- PIVOT_AT is the moment the story turns — the evidence window is drawn around
-- it. EVIDENCE holds the computed facts Cortex is allowed to narrate, and
-- nothing else.
-- ─────────────────────────────────────────────────────────────────────────────

-- RELAPSE — went dark, came back.
CREATE OR REPLACE VIEW STORY_RELAPSE AS
SELECT
    g.REPO_OWNER,
    g.REPO_NAME,
    'relapse'                           AS STORYLINE,
    LEAST(100, ROUND(g.GAP_DAYS * 0.8)) AS SCORE,   -- 125 dark days saturates the scale
    g.AUTHORED_AT                       AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'gapDays',      g.GAP_DAYS,
        'wentQuietAt',  TO_VARCHAR(g.PREV_AT),
        'cameBackAt',   TO_VARCHAR(g.AUTHORED_AT),
        'cameBackHour', g.UTC_HOUR,
        'cameBackWith', g.SUBJECT
    )                                   AS EVIDENCE
FROM COMMIT_GAPS g
JOIN REPO_FACTS f USING (REPO_OWNER, REPO_NAME)
CROSS JOIN DETECTOR_CONFIG cfg
WHERE f.COMMIT_COUNT >= cfg.MIN_COMMITS
  AND g.GAP_DAYS     >= cfg.RELAPSE_MIN_GAP_DAYS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY g.REPO_OWNER, g.REPO_NAME
    ORDER BY g.GAP_DAYS DESC, g.AUTHORED_AT   -- longest dark stretch; earliest breaks the tie
) = 1;

-- NOCTURNE — a repo that only exists after dark.
CREATE OR REPLACE VIEW STORY_NOCTURNE AS
WITH night AS (
    SELECT
        c.REPO_OWNER, c.REPO_NAME,
        MAX(c.AUTHORED_AT) AS LATEST_NIGHT_AT,
        MODE(c.UTC_HOUR)   AS TYPICAL_NIGHT_HOUR
    FROM COMMITS_CLEAN c
    CROSS JOIN DETECTOR_CONFIG cfg
    WHERE c.UTC_HOUR >= cfg.NIGHT_START_HOUR
       OR c.UTC_HOUR <  cfg.NIGHT_END_HOUR
    GROUP BY c.REPO_OWNER, c.REPO_NAME
)
SELECT
    f.REPO_OWNER,
    f.REPO_NAME,
    'nocturne'                                    AS STORYLINE,
    ROUND(100 * f.NIGHT_COMMITS / f.COMMIT_COUNT) AS SCORE,
    n.LATEST_NIGHT_AT                             AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'nightCommits',        f.NIGHT_COMMITS,
        'totalCommits',        f.COMMIT_COUNT,
        'nightSharePct',       ROUND(100 * f.NIGHT_COMMITS / f.COMMIT_COUNT),
        'typicalNightHourUtc', n.TYPICAL_NIGHT_HOUR,
        'latestNightCommitAt', TO_VARCHAR(n.LATEST_NIGHT_AT)
    )                                             AS EVIDENCE
FROM REPO_FACTS f
JOIN night n USING (REPO_OWNER, REPO_NAME)
CROSS JOIN DETECTOR_CONFIG cfg
WHERE f.COMMIT_COUNT  >= cfg.MIN_COMMITS
  AND f.NIGHT_COMMITS >= 0.5 * f.COMMIT_COUNT;   -- a minority of night commits is not a habit

-- BINGE — the longest unbroken run of days.
CREATE OR REPLACE VIEW STORY_BINGE AS
WITH active_days AS (
    SELECT DISTINCT REPO_OWNER, REPO_NAME, AUTHORED_DATE FROM COMMITS_CLEAN
),
-- Consecutive dates share a (date - row_number) key. Classic gaps-and-islands.
islands AS (
    SELECT
        REPO_OWNER, REPO_NAME, AUTHORED_DATE,
        DATEADD(day, -ROW_NUMBER() OVER (
            PARTITION BY REPO_OWNER, REPO_NAME ORDER BY AUTHORED_DATE
        ), AUTHORED_DATE) AS ISLAND_KEY
    FROM active_days
),
streaks AS (
    SELECT
        REPO_OWNER, REPO_NAME, ISLAND_KEY,
        COUNT(*)           AS STREAK_DAYS,
        MIN(AUTHORED_DATE) AS STREAK_START,
        MAX(AUTHORED_DATE) AS STREAK_END
    FROM islands
    GROUP BY REPO_OWNER, REPO_NAME, ISLAND_KEY
)
SELECT
    s.REPO_OWNER,
    s.REPO_NAME,
    'binge'                       AS STORYLINE,
    -- Deliberately the flattest curve of the six. "They worked ten days straight"
    -- is the weakest story here, and at *7 it was outscoring a genuine 56% night
    -- habit. A binge has to be genuinely obsessive (25+ days) before it wins.
    LEAST(100, s.STREAK_DAYS * 4) AS SCORE,
    TO_TIMESTAMP_TZ(s.STREAK_END) AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'streakDays',   s.STREAK_DAYS,
        'streakStart',  TO_VARCHAR(s.STREAK_START),
        'streakEnd',    TO_VARCHAR(s.STREAK_END),
        'totalCommits', f.COMMIT_COUNT,
        'activeDays',   f.ACTIVE_DAYS
    )                             AS EVIDENCE
FROM streaks s
JOIN REPO_FACTS f USING (REPO_OWNER, REPO_NAME)
CROSS JOIN DETECTOR_CONFIG cfg
WHERE f.COMMIT_COUNT >= cfg.MIN_COMMITS
  AND s.STREAK_DAYS  >= cfg.BINGE_MIN_STREAK_DAYS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY s.REPO_OWNER, s.REPO_NAME
    ORDER BY s.STREAK_DAYS DESC, s.STREAK_END
) = 1;

-- COLLAPSE — it did not taper. It spiked, and then it stopped.
CREATE OR REPLACE VIEW STORY_COLLAPSE AS
WITH final_burst AS (
    SELECT
        c.REPO_OWNER, c.REPO_NAME,
        COUNT(*) AS COMMITS_IN_FINAL_30D
    FROM COMMITS_CLEAN c
    JOIN REPO_FACTS f USING (REPO_OWNER, REPO_NAME)
    WHERE c.AUTHORED_AT >= DATEADD(day, -30, f.LAST_COMMIT_AT)
    GROUP BY c.REPO_OWNER, c.REPO_NAME
),
last_commit AS (
    SELECT REPO_OWNER, REPO_NAME, SUBJECT, AUTHORED_AT, UTC_HOUR
    FROM COMMITS_CLEAN
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY REPO_OWNER, REPO_NAME ORDER BY AUTHORED_AT DESC
    ) = 1
)
SELECT
    f.REPO_OWNER,
    f.REPO_NAME,
    'collapse'    AS STORYLINE,
    -- Base 40 for being dead at all, plus how long it has been dead, plus how hot
    -- it was running when it died. A slow fade cannot outscore a real spike.
    LEAST(100, ROUND(
        40
        + LEAST(30, f.DAYS_SINCE_LAST / 12.0)
        + 30 * (b.COMMITS_IN_FINAL_30D / f.COMMIT_COUNT)
    ))            AS SCORE,
    l.AUTHORED_AT AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'daysSinceLastCommit',  f.DAYS_SINCE_LAST,
        'commitsInFinal30Days', b.COMMITS_IN_FINAL_30D,
        'totalCommits',         f.COMMIT_COUNT,
        'spanDays',             f.SPAN_DAYS,
        'lastCommitAt',         TO_VARCHAR(l.AUTHORED_AT),
        'lastCommitHour',       l.UTC_HOUR,
        'lastCommitSubject',    l.SUBJECT
    )             AS EVIDENCE
FROM REPO_FACTS f
JOIN final_burst b USING (REPO_OWNER, REPO_NAME)
JOIN last_commit l USING (REPO_OWNER, REPO_NAME)
CROSS JOIN DETECTOR_CONFIG cfg
WHERE f.COMMIT_COUNT       >= cfg.MIN_COMMITS
  AND f.DAYS_SINCE_LAST    >= cfg.ABANDONED_AFTER_DAYS
  AND b.COMMITS_IN_FINAL_30D >= 0.15 * f.COMMIT_COUNT;  -- it was still busy when it died

-- FIGHT — a cluster of reverts and hotfixes inside one week. Regex, not AI.
CREATE OR REPLACE VIEW STORY_FIGHT AS
WITH fights AS (
    SELECT REPO_OWNER, REPO_NAME, SUBJECT, AUTHORED_AT
    FROM COMMITS_CLEAN
    -- REGEXP_LIKE(..., 'i'), not an inline (?i): Snowflake's regex engine rejects
    -- inline flags and does not honour \b. Substring match is enough — "revert"
    -- already catches "reverted" and "reverting".
    WHERE REGEXP_LIKE(SUBJECT, '.*(revert|hotfix|rollback|roll back|re-fix|refix).*', 'i')
),
-- Every fight commit anchors a 7-day window; the densest window wins.
windows AS (
    SELECT
        a.REPO_OWNER,
        a.REPO_NAME,
        a.AUTHORED_AT      AS WINDOW_START,
        MAX(b.AUTHORED_AT) AS WINDOW_END,
        COUNT(*)           AS FIGHT_COMMITS,
        ARRAY_AGG(b.SUBJECT) WITHIN GROUP (ORDER BY b.AUTHORED_AT) AS FIGHT_SUBJECTS
    FROM fights a
    JOIN fights b
      ON  a.REPO_OWNER = b.REPO_OWNER
      AND a.REPO_NAME  = b.REPO_NAME
      AND b.AUTHORED_AT BETWEEN a.AUTHORED_AT AND DATEADD(day, 7, a.AUTHORED_AT)
    GROUP BY a.REPO_OWNER, a.REPO_NAME, a.AUTHORED_AT
)
SELECT
    w.REPO_OWNER,
    w.REPO_NAME,
    'fight'                          AS STORYLINE,
    LEAST(100, w.FIGHT_COMMITS * 15) AS SCORE,
    w.WINDOW_END                     AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'fightCommits',  w.FIGHT_COMMITS,
        'windowStart',   TO_VARCHAR(w.WINDOW_START),
        'windowEnd',     TO_VARCHAR(w.WINDOW_END),
        'totalCommits',  f.COMMIT_COUNT,
        'fightSubjects', w.FIGHT_SUBJECTS
    )                                AS EVIDENCE
FROM windows w
JOIN REPO_FACTS f USING (REPO_OWNER, REPO_NAME)
CROSS JOIN DETECTOR_CONFIG cfg
WHERE f.COMMIT_COUNT  >= cfg.MIN_COMMITS
  AND w.FIGHT_COMMITS >= cfg.FIGHT_MIN_COMMITS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY w.REPO_OWNER, w.REPO_NAME
    ORDER BY w.FIGHT_COMMITS DESC, w.WINDOW_START
) = 1;

-- RESURRECTION — dead, returned, AND shipped. Strictly a better story than a bare
-- relapse, so it is scored to outrank the relapse it is built on.
CREATE OR REPLACE VIEW STORY_RESURRECTION AS
WITH shipped_after_return AS (
    SELECT
        r.REPO_OWNER,
        r.REPO_NAME,
        MIN(c.AUTHORED_AT)               AS RELEASE_AT,
        MIN_BY(c.SUBJECT, c.AUTHORED_AT) AS RELEASE_SUBJECT
    FROM STORY_RELAPSE r
    JOIN COMMITS_CLEAN c USING (REPO_OWNER, REPO_NAME)
    WHERE c.AUTHORED_AT >= r.PIVOT_AT
      AND REGEXP_LIKE(
              c.SUBJECT,
              '.*(chore\\(release\\)|release-please|bump version|release |v?[0-9]+\\.[0-9]+\\.[0-9]+).*',
              'i'
          )
    GROUP BY r.REPO_OWNER, r.REPO_NAME
)
SELECT
    r.REPO_OWNER,
    r.REPO_NAME,
    'resurrection'           AS STORYLINE,
    LEAST(100, r.SCORE + 15) AS SCORE,
    s.RELEASE_AT             AS PIVOT_AT,
    OBJECT_CONSTRUCT(
        'gapDays',      r.EVIDENCE:gapDays,
        'wentQuietAt',  r.EVIDENCE:wentQuietAt,
        'cameBackAt',   r.EVIDENCE:cameBackAt,
        'cameBackHour', r.EVIDENCE:cameBackHour,
        'cameBackWith', r.EVIDENCE:cameBackWith,
        'shippedAt',    TO_VARCHAR(s.RELEASE_AT),
        'shippedWith',  s.RELEASE_SUBJECT
    )                        AS EVIDENCE
FROM STORY_RELAPSE r
JOIN shipped_after_return s USING (REPO_OWNER, REPO_NAME);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Score every storyline, then pick exactly one.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW STORYLINE_SCORES AS
WITH every_story AS (
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_RELAPSE      UNION ALL
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_NOCTURNE     UNION ALL
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_BINGE        UNION ALL
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_COLLAPSE     UNION ALL
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_FIGHT        UNION ALL
    SELECT REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE FROM STORY_RESURRECTION
)
SELECT
    REPO_OWNER, REPO_NAME, STORYLINE, SCORE, PIVOT_AT, EVIDENCE,
    -- Ties are broken by which story is worth telling, not by which name sorts
    -- first. Alphabetical order would hand every tie to 'binge', the dullest of
    -- the six, purely because it starts with a b.
    CASE STORYLINE
        WHEN 'resurrection' THEN 1   -- dead, back, and shipped
        WHEN 'collapse'     THEN 2   -- it spiked, then it stopped
        WHEN 'relapse'      THEN 3   -- went dark, came back
        WHEN 'nocturne'     THEN 4   -- it only ever happened at night
        WHEN 'fight'        THEN 5   -- a week of reverts
        WHEN 'binge'        THEN 6   -- they worked a lot of days in a row
    END AS DRAMA_RANK
FROM every_story;

-- The winner. Repos below the floor, or with nothing that fired, surface as 'none'
-- rather than vanishing — a sparse repo gets an honest template card, not
-- manufactured drama.
CREATE OR REPLACE VIEW REPO_STORYLINE AS
SELECT
    f.REPO_OWNER,
    f.REPO_NAME,
    COALESCE(s.STORYLINE, 'none')            AS STORYLINE,
    COALESCE(s.SCORE, 0)                     AS SCORE,
    s.PIVOT_AT,
    COALESCE(s.EVIDENCE, OBJECT_CONSTRUCT()) AS EVIDENCE,
    OBJECT_CONSTRUCT(
        'commitCount',       f.COMMIT_COUNT,
        'authorCount',       f.AUTHOR_COUNT,
        'activeDays',        f.ACTIVE_DAYS,
        'spanDays',          f.SPAN_DAYS,
        'daysSinceLast',     f.DAYS_SINCE_LAST,
        'nightCommits',      f.NIGHT_COMMITS,
        'aiAssistedCommits', f.AI_ASSISTED_COMMITS,
        'firstCommitAt',     TO_VARCHAR(f.FIRST_COMMIT_AT),
        'lastCommitAt',      TO_VARCHAR(f.LAST_COMMIT_AT)
    )                                        AS FACTS
FROM REPO_FACTS f
LEFT JOIN STORYLINE_SCORES s USING (REPO_OWNER, REPO_NAME)
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY f.REPO_OWNER, f.REPO_NAME
    ORDER BY s.SCORE DESC NULLS LAST, s.DRAMA_RANK  -- score first, then drama; never alphabetical
) = 1;

-- 5. The Cortex input. Only the winning thread's commits — never the whole history.
-- Drawn around the pivot, plus the opening and the ending, which belong to the arc
-- no matter which storyline won.
CREATE OR REPLACE VIEW CARD_EVIDENCE AS
WITH picked AS (
    SELECT
        c.REPO_OWNER, c.REPO_NAME, c.SUBJECT, c.AUTHORED_AT, c.UTC_HOUR, c.IS_AI_ASSISTED
    FROM COMMITS_CLEAN c
    JOIN REPO_STORYLINE w USING (REPO_OWNER, REPO_NAME)
    -- The pivot window only exists when there IS a pivot. A 'none' storyline has a NULL
    -- PIVOT_AT, which makes ABS(DATEDIFF(...)) NULL for every row — the whole partition
    -- ties, and ROW_NUMBER then picks twelve commits arbitrarily and differently each
    -- run. A no-story repo gets its opening and its ending, which is all it has.
    --
    -- AUTHORED_AT is the tiebreak, not decoration: two commits equidistant from the
    -- pivot tie as well, and an arbitrary winner there is the same bug wearing a smaller
    -- hat. Scoring is deterministic or it is not a detector.
    QUALIFY
        (w.PIVOT_AT IS NOT NULL
         AND ROW_NUMBER() OVER (PARTITION BY c.REPO_OWNER, c.REPO_NAME
                                ORDER BY ABS(DATEDIFF(hour, w.PIVOT_AT, c.AUTHORED_AT)),
                                         c.AUTHORED_AT) <= 12)
     OR ROW_NUMBER() OVER (PARTITION BY c.REPO_OWNER, c.REPO_NAME
                           ORDER BY c.AUTHORED_AT, c.SHA) <= 3
     OR ROW_NUMBER() OVER (PARTITION BY c.REPO_OWNER, c.REPO_NAME
                           ORDER BY c.AUTHORED_AT DESC, c.SHA) <= 5
)
SELECT
    w.REPO_OWNER,
    w.REPO_NAME,
    w.STORYLINE,
    w.SCORE,
    w.FACTS,
    w.EVIDENCE,
    ARRAY_AGG(OBJECT_CONSTRUCT(
        'subject',    p.SUBJECT,
        'authoredAt', TO_VARCHAR(p.AUTHORED_AT),
        'utcHour',    p.UTC_HOUR,
        'aiAssisted', p.IS_AI_ASSISTED
    )) WITHIN GROUP (ORDER BY p.AUTHORED_AT) AS COMMITS
FROM REPO_STORYLINE w
JOIN picked p USING (REPO_OWNER, REPO_NAME)
GROUP BY w.REPO_OWNER, w.REPO_NAME, w.STORYLINE, w.SCORE, w.FACTS, w.EVIDENCE;

-- 6. Verify. One query, every repo currently ingested: what fired, and what won.
SELECT
    r.REPO_OWNER || '/' || r.REPO_NAME AS REPO,
    r.STORYLINE                        AS WINNER,
    r.SCORE                            AS WINNING_SCORE,
    ARRAY_AGG(s.STORYLINE || ':' || s.SCORE)
        WITHIN GROUP (ORDER BY s.SCORE DESC) AS ALL_STORYLINES,
    r.EVIDENCE
FROM REPO_STORYLINE r
LEFT JOIN STORYLINE_SCORES s USING (REPO_OWNER, REPO_NAME)
GROUP BY r.REPO_OWNER, r.REPO_NAME, r.STORYLINE, r.SCORE, r.EVIDENCE
ORDER BY REPO;
