-- Commit Chronicles — storyline detector. Plain SQL, no LLM.
--
-- Snowflake regex: anchors at BOTH ends (bare prefixes match nothing), rejects inline
-- flags like (?i), ignores \b.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

CREATE OR REPLACE VIEW DETECTOR_CONFIG AS
SELECT
    15 AS MIN_COMMITS,
    30 AS RELAPSE_MIN_GAP_DAYS,
    90 AS ABANDONED_AFTER_DAYS,
     7 AS BINGE_MIN_STREAK_DAYS,
     4 AS FIGHT_MIN_COMMITS,
    22 AS NIGHT_START_HOUR,
     5 AS NIGHT_END_HOUR;

-- DAYS_SINCE_LAST is relative to now, so COLLAPSE is a claim about today.
CREATE OR REPLACE VIEW REPO_FACTS AS
SELECT
    c.REPO_OWNER,
    c.REPO_NAME,
    COUNT(*)                                        AS COMMIT_COUNT,
    COUNT(DISTINCT c.AUTHOR)                        AS AUTHOR_COUNT,
    COUNT(DISTINCT c.AUTHORED_DATE)                 AS ACTIVE_DAYS,
    MIN(c.AUTHORED_AT)                              AS FIRST_COMMIT_AT,
    MAX(c.AUTHORED_AT)                              AS LAST_COMMIT_AT,
    MIN_BY(c.SUBJECT, c.AUTHORED_AT)                AS FIRST_COMMIT_SUBJECT,
    MAX_BY(c.SUBJECT, c.AUTHORED_AT)                AS LAST_COMMIT_SUBJECT,
    MODE(c.AUTHOR)                                  AS PRIMARY_AUTHOR,
    MODE(c.AUTHOR_LOGIN)                            AS PRIMARY_AUTHOR_LOGIN,
    DATEDIFF(day, MIN(c.AUTHORED_AT), MAX(c.AUTHORED_AT))  AS SPAN_DAYS,
    DATEDIFF(day, MAX(c.AUTHORED_AT), CURRENT_TIMESTAMP()) AS DAYS_SINCE_LAST,
    SUM(IFF(c.UTC_HOUR >= cfg.NIGHT_START_HOUR
         OR c.UTC_HOUR <  cfg.NIGHT_END_HOUR, 1, 0))       AS NIGHT_COMMITS,
    SUM(IFF(c.IS_AI_ASSISTED, 1, 0))                AS AI_ASSISTED_COMMITS
FROM COMMITS_CLEAN c
CROSS JOIN DETECTOR_CONFIG cfg
GROUP BY c.REPO_OWNER, c.REPO_NAME;

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

-- The card draws a void panel over the longest silence whichever storyline wins, so the
-- gap cannot live only in the relapse evidence.
CREATE OR REPLACE VIEW REPO_LARGEST_GAP AS
SELECT
    REPO_OWNER, REPO_NAME,
    GAP_DAYS,
    PREV_AT     AS DARK_FROM,
    AUTHORED_AT AS DARK_TO
FROM COMMIT_GAPS
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY REPO_OWNER, REPO_NAME ORDER BY GAP_DAYS DESC, AUTHORED_AT
) = 1;

-- Every storyline emits: REPO_OWNER, REPO_NAME, STORYLINE, SCORE (0-100), PIVOT_AT, EVIDENCE.

CREATE OR REPLACE VIEW STORY_RELAPSE AS
SELECT
    g.REPO_OWNER,
    g.REPO_NAME,
    'relapse'                           AS STORYLINE,
    LEAST(100, ROUND(g.GAP_DAYS * 0.8)) AS SCORE,
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
    ORDER BY g.GAP_DAYS DESC, g.AUTHORED_AT
) = 1;

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
  AND f.NIGHT_COMMITS >= 0.5 * f.COMMIT_COUNT;

-- Score curve is the flattest of the six: a long streak is the weakest story here.
CREATE OR REPLACE VIEW STORY_BINGE AS
WITH active_days AS (
    SELECT DISTINCT REPO_OWNER, REPO_NAME, AUTHORED_DATE FROM COMMITS_CLEAN
),
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
  AND b.COMMITS_IN_FINAL_30D >= 0.15 * f.COMMIT_COUNT;

CREATE OR REPLACE VIEW STORY_FIGHT AS
WITH fights AS (
    SELECT REPO_OWNER, REPO_NAME, SUBJECT, AUTHORED_AT
    FROM COMMITS_CLEAN
    WHERE REGEXP_LIKE(SUBJECT, '.*(revert|hotfix|rollback|roll back|re-fix|refix).*', 'i')
),
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

-- Scored above the relapse it is built on, so it always outranks it.
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
    CASE STORYLINE
        WHEN 'resurrection' THEN 1
        WHEN 'collapse'     THEN 2
        WHEN 'relapse'      THEN 3
        WHEN 'nocturne'     THEN 4
        WHEN 'fight'        THEN 5
        WHEN 'binge'        THEN 6
    END AS DRAMA_RANK
FROM every_story;

CREATE OR REPLACE VIEW REPO_STORYLINE AS
SELECT
    f.REPO_OWNER,
    f.REPO_NAME,
    COALESCE(s.STORYLINE, 'none')            AS STORYLINE,
    COALESCE(s.SCORE, 0)                     AS SCORE,
    s.PIVOT_AT,
    COALESCE(s.EVIDENCE, OBJECT_CONSTRUCT()) AS EVIDENCE,
    OBJECT_CONSTRUCT(
        'commitCount',        f.COMMIT_COUNT,
        'authorCount',        f.AUTHOR_COUNT,
        'primaryAuthor',      f.PRIMARY_AUTHOR,
        'primaryAuthorLogin', f.PRIMARY_AUTHOR_LOGIN,
        'activeDays',         f.ACTIVE_DAYS,
        'spanDays',           f.SPAN_DAYS,
        'daysSinceLast',      f.DAYS_SINCE_LAST,
        'nightCommits',       f.NIGHT_COMMITS,
        'aiAssistedCommits',  f.AI_ASSISTED_COMMITS,
        'firstCommitAt',      TO_VARCHAR(f.FIRST_COMMIT_AT),
        'firstCommitSubject', f.FIRST_COMMIT_SUBJECT,
        'lastCommitAt',       TO_VARCHAR(f.LAST_COMMIT_AT),
        'lastCommitSubject',  f.LAST_COMMIT_SUBJECT,
        'largestGap',         IFF(g.GAP_DAYS IS NULL, NULL, OBJECT_CONSTRUCT(
            'days', g.GAP_DAYS,
            'from', TO_VARCHAR(g.DARK_FROM),
            'to',   TO_VARCHAR(g.DARK_TO)
        ))
    )                                        AS FACTS
FROM REPO_FACTS f
LEFT JOIN REPO_LARGEST_GAP g USING (REPO_OWNER, REPO_NAME)
LEFT JOIN STORYLINE_SCORES s USING (REPO_OWNER, REPO_NAME)
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY f.REPO_OWNER, f.REPO_NAME
    ORDER BY s.SCORE DESC NULLS LAST, s.DRAMA_RANK
) = 1;

-- The only rows Cortex ever sees. A 'none' storyline has a NULL PIVOT_AT, which would
-- make the pivot window tie across the whole partition and pick rows nondeterministically.
CREATE OR REPLACE VIEW CARD_EVIDENCE AS
WITH picked AS (
    SELECT
        c.REPO_OWNER, c.REPO_NAME, c.SUBJECT, c.AUTHORED_AT, c.UTC_HOUR, c.IS_AI_ASSISTED
    FROM COMMITS_CLEAN c
    JOIN REPO_STORYLINE w USING (REPO_OWNER, REPO_NAME)
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
