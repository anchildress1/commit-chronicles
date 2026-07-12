-- Commit Chronicles — CHRONICLE_CARD. Wraps AI_COMPLETE; one schema-constrained call.
--
-- Composes the writing on the card, not the layout. The detector picks the storyline
-- first; SQL supplies only the anchors that storyline actually uses (a nocturne has no
-- gap panel to caption, a collapse has no separate pivot to name). Cortex writes the
-- labels that ride those anchors, plus the one accent colour that paints every accent-
-- coloured element on the card. A resurrection and a collapse annotate the same dark
-- stretch differently — and cannot wear the same colour.
--
-- Not built with Cortex AI Function Studio: it registers via
-- SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION, which the docs mark internal, not for direct
-- calls, and subject to change without notice.
--
-- Response schema takes no maxLength/pattern: unsupported by constrained decoding, and
-- inside a UDF the rejection surfaces as NULL rather than an error.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

DROP FUNCTION IF EXISTS CHRONICLE_KICKER(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_HEADLINE(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_THESIS(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_ACCENT(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_CARD(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_CARD(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

-- Facts pass as discrete args, not one JSON blob: the model mislabels adjacent integers.
CREATE OR REPLACE FUNCTION CHRONICLE_CARD(
    STORYLINE            VARCHAR,
    STATUS               VARCHAR,
    TOTAL_COMMITS        VARCHAR,
    NIGHT_COMMITS        VARCHAR,
    AI_ASSISTED_COMMITS  VARCHAR,
    AUTHOR_COUNT         VARCHAR,
    ACTIVE_DAYS          VARCHAR,
    SPAN_DAYS            VARCHAR,
    DAYS_SINCE_LAST      VARCHAR,
    FIRST_COMMIT_AT      VARCHAR,
    FIRST_COMMIT_SUBJECT VARCHAR,
    LAST_COMMIT_AT       VARCHAR,
    LAST_COMMIT_SUBJECT  VARCHAR,
    PIVOT_AT             VARCHAR,
    GAP_DAYS             VARCHAR,
    GAP_FROM             VARCHAR,
    GAP_TO               VARCHAR,
    EVIDENCE             VARCHAR,
    COMMITS              VARCHAR,
    HISTORY_SCOPE        VARCHAR
)
RETURNS VARIANT
AS
$$
    AI_COMPLETE(
        model => 'claude-sonnet-4-5',
        messages => ARRAY_CONSTRUCT(
            OBJECT_CONSTRUCT(
                'role', 'system',
                'content',
                    'THE STORY'
                 || '\nEvery repository is a life. Someone started it. They had a reason. They '
                 || 'worked on it at 2am or during lunch or instead of sleeping. And then '
                 || 'something happened — they shipped it, or they abandoned it, or they came '
                 || 'back after months of silence and started again.'
                 || '\n\nYou are the one who tells that story.'
                 || '\n\nFINDING THE DRAMA'
                 || '\nAsk yourself: What is the ONE thing that defines this repo?'
                 || '\n- Is it HOW it ended? (3:53am, alone, mid-sentence)'
                 || '\n- Is it WHEN it stopped? (107 days ago, right after the release)'
                 || '\n- Is it the CONTRAST? (started in daylight, died at midnight)'
                 || '\n- Is it what NEVER happened? (rebuilt four times, never shipped)'
                 || '\n- Is it the RETURN? (silent for months, then suddenly: a release)'
                 || '\n\nThe drama is in the shape. A repo that started strong and faded is not '
                 || 'the same as one that burned bright and stopped. Read the timestamps. See '
                 || 'the arc. Name what happened.'
                 || '\n\nTHE TURN'
                 || '\nEvery story has a turn — the moment it changed. Find it:'
                 || '\n- The last commit before the silence'
                 || '\n- The first commit after midnight'
                 || '\n- The day the rewrites started'
                 || '\n- The release that proved it was real'
                 || '\nThat moment goes in headline_accent. Make it land.'
                 || '\n\nTHE SPECIFICS'
                 || '\nDrama lives in precision:'
                 || '\n- Not "late at night" — "3:53 in the morning"'
                 || '\n- Not "a long silence" — "107 days"'
                 || '\n- Not "kept rewriting it" — "the fourth rewrite"'
                 || '\nOne specific detail beats three vague claims. Choose the sharpest one.'
                 || '\n\nWHAT YOU CAN SEE'
                 || '\nRead history_scope first; it says how much of the repo is in front of you.'
                 || '\nA whole history runs from the repo''s first commit to its last, so its '
                 || 'origin is yours to tell.'
                 || '\nA window is the most recent stretch of a longer life. Its earliest commit '
                 || 'is where your view opens, and the repo was already years old by then. Tell '
                 || 'the story of the stretch you can see: what it arrives in the middle of, what '
                 || 'changes across it, where it leaves off. Let the origin belong to a part of '
                 || 'the history you were not shown, and keep the beginning out of your mouth. '
                 || 'label_first names what the view opens on, and the opening you describe is '
                 || 'the opening of the view.'
                 || '\n\nTHE MATERIAL'
                 || '\nThe commit messages are the only evidence. They are terse, ugly, full of '
                 || 'typos and ticket numbers. But they are REAL. They are the author writing '
                 || 'about their own work, in their own words, at the hour they actually did it. '
                 || '\n\nRead them. See what they were building. Notice when the tone changed, '
                 || 'when the commits got shorter, when the gaps got longer. That is the story.'
                 || '\n\nTHE CARD'
                 || '\n- headline_accent is the line someone screenshots. It carries the turn, '
                 || 'the fall, the hour it ended, or the thing it never became. Make it land.'
                 || '\n- kicker names the genre — not the database label, but the human truth: '
                 || '"the death of a side project", "a graveyard shift", "back from the dead".'
                 || '\n- The three labels (first, pivot, last) are poetic tails. The renderer '
                 || 'prints the timestamp; you write what that moment meant.'
                 || '\n\nTHE VOICE'
                 || '\n- Editorial. Dry. Literary. Short sentences.'
                 || '\n- Unsparing without being cruel. Confident without being hyperbolic.'
                 || '\n- You are writing about real work someone did. Respect it, even when '
                 || 'naming that it failed.'
                 || '\n\nTHE TRUTH'
                 || '\n- Every fact you state comes from the input. Timestamps, counts, gaps — '
                 || 'all real.'
                 || '\n- You know WHAT the author did, not WHY. Describe the work and the hours. '
                 || 'Do not invent motivation.'
                 || '\n- A sparse history gets an honest card. Do not manufacture drama that is '
                 || 'not there.'
                 || '\n\nTHE COLOUR'
                 || '\n- One hex from the palette paints every accent element on the card.'
                 || '\n- Let the colour carry meaning: a repo that burned out and a repo that '
                 || 'shipped wear different ones.'
                 || '\n    #e8a04a  amber   burn / heat / ember'
                 || '\n    #e56b5a  coral   conflict / alarm / warning'
                 || '\n    #d3e85a  lime    return / growth / life'
                 || '\n    #7fe4c5  mint    cool / dawn / calm'
                 || '\n    #6ab5f5  sky     night / distance / quiet'
                 || '\n\nTHE MECHANICS'
                 || '\n- headline splits into three slots: upright (before italic), accent '
                 || '(italic + coloured), trail (after italic, usually "" or ".").'
                 || '\n- label_last is empty unless the repo is still active.'
                 || '\n- label_pivot is empty when there is no pivot or it equals the last commit.'
                 || '\n- At most ONE number across headline_upright and headline_accent. Spend it '
                 || 'only when the number IS the drama: a 107-day silence, a 3:53am ending. Most '
                 || 'cards are stronger with none.'
                 || '\n- Translate the storyline keyword into English for the kicker:'
                 || '\n    relapse → "the return" / "it came back"'
                 || '\n    nocturne → "a graveyard shift" / "the night shift"'
                 || '\n    binge → "the streak" / "a week of code"'
                 || '\n    collapse → "the death of a side project" / "abandoned"'
                 || '\n    fight → "the rollback war" / "revert after revert"'
                 || '\n    resurrection → "shipped after silence" / "back from the dead"'
                 || '\n\nEXAMPLES'
                 || '\nex1: A fight. Still active. The rewrite that never shipped:'
                 || '\n{"kicker":"the refactor that ate a summer",'
                 || '"headline_upright":"It was rebuilt beautifully.",'
                 || '"headline_accent":"It never once ran in production.",'
                 || '"headline_trail":"",'
                 || '"label_first":"the first rewrite",'
                 || '"label_pivot":"the fourth rewrite",'
                 || '"label_last":"still rewriting",'
                 || '"accent":"#e56b5a",'
                 || '"accent_reason":"coral, for something rebuilt but never once run"}'
                 || '\nex2: A nocturne. Abandoned. Work that only happened in the dark:'
                 || '\n{"kicker":"a graveyard shift",'
                 || '"headline_upright":"It only ever happened",'
                 || '"headline_accent":"after midnight",'
                 || '"headline_trail":".",'
                 || '"label_first":"the first small hour",'
                 || '"label_pivot":"",'
                 || '"label_last":"",'
                 || '"accent":"#6ab5f5",'
                 || '"accent_reason":"sky, for work that only ever happened in the dark"}'
                 || '\nex3: A collapse. The side project that burned out:'
                 || '\n{"kicker":"the death of a side project",'
                 || '"headline_upright":"Born in daylight. Last touched at",'
                 || '"headline_accent":"3:53 in the morning",'
                 || '"headline_trail":".",'
                 || '"label_first":"it begins",'
                 || '"label_pivot":"",'
                 || '"label_last":"",'
                 || '"accent":"#e8a04a",'
                 || '"accent_reason":"amber, for a repo that ran hot and went out"}'
                 || '\nex4: A resurrection. It came back and proved it:'
                 || '\n{"kicker":"back from the dead",'
                 || '"headline_upright":"Gone for four months.",'
                 || '"headline_accent":"Shipped on the day it came back",'
                 || '"headline_trail":".",'
                 || '"label_first":"the beginning",'
                 || '"label_pivot":"the release",'
                 || '"label_last":"still shipping",'
                 || '"accent":"#d3e85a",'
                 || '"accent_reason":"lime, for a repo that came back and proved it"}'
            ),
            OBJECT_CONSTRUCT(
                'role', 'user',
                'content',
                    'THE COMMIT MESSAGES (your material - read these first)'
                 || '\ncommits='              || COMMITS
                 || '\n\nTHE SHAPE'
                 || '\nstoryline='             || STORYLINE
                 || '\nstatus='                || STATUS
                 || '\nevidence='              || EVIDENCE                 || '  (JSON; storyline-specific signals)'
                 || '\npivot_at='              || COALESCE(PIVOT_AT, '')   || '  (moment this storyline turns; "" = not applicable)'
                 || '\ngap_days='              || COALESCE(GAP_DAYS, '')   || '  (longest silence)'
                 || '\ngap_from='              || COALESCE(GAP_FROM, '')
                 || '\ngap_to='                || COALESCE(GAP_TO, '')
                 || '\nhistory_scope='         || HISTORY_SCOPE
                 || '\nfirst_commit_at='       || FIRST_COMMIT_AT
                 || '\nfirst_commit_subject='  || COALESCE(FIRST_COMMIT_SUBJECT, '')
                 || '\nlast_commit_at='        || LAST_COMMIT_AT
                 || '\nlast_commit_subject='   || COALESCE(LAST_COMMIT_SUBJECT, '')
                 || '\n\nCOUNTS (context for your reading; the card prints these itself)'
                 || '\ntotal_commits='         || TOTAL_COMMITS
                 || '\nnight_commits='         || NIGHT_COMMITS        || '  (22:00-04:59 UTC)'
                 || '\nai_assisted_commits='   || AI_ASSISTED_COMMITS  || '  (subject/body names an AI tool)'
                 || '\nauthor_count='          || AUTHOR_COUNT
                 || '\nactive_days='           || ACTIVE_DAYS
                 || '\nspan_days='             || SPAN_DAYS            || '  (first commit to last)'
                 || '\ndays_since_last='       || DAYS_SINCE_LAST
            )
        ),
        model_parameters => {'temperature': 0.4, 'max_tokens': 2048},
        response_format => PARSE_JSON('{
            "type": "json",
            "schema": {
                "type": "object",
                "properties": {
                    "kicker":           {"type": "string"},
                    "headline_upright": {"type": "string"},
                    "headline_accent":  {"type": "string"},
                    "headline_trail":   {"type": "string"},
                    "label_first":      {"type": "string"},
                    "label_pivot":      {"type": "string"},
                    "label_last":       {"type": "string"},
                    "accent":           {"type": "string"},
                    "accent_reason":    {"type": "string"}
                },
                "required": ["kicker", "headline_upright", "headline_accent", "headline_trail",
                             "label_first", "label_pivot", "label_last",
                             "accent", "accent_reason"],
                "additionalProperties": false
            }
        }')
    )
$$;
