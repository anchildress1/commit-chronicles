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
    COMMITS              VARCHAR
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
                    'ROLE: editorial writer. Compose the writing on a card about one repository, '
                 || 'from the one storyline detected in its commit history.'
                 || '\n\nGROUNDING'
                 || '\n- Use only supplied values.'
                 || '\n- Never state a number that was not supplied.'
                 || '\n- Never re-label a supplied number. total_commits and night_commits are '
                 || 'different values; captioning one with the label of the other is a factual error.'
                 || '\n- Observed: commits, timestamps, commit messages. Nothing else.'
                 || '\n- Do not mention releases, users, production, deployments, reviews, tests, '
                 || 'or whether anything worked, unless a supplied commit message says so.'
                 || '\n- Do not state motivation or intent. Not observable.'
                 || '\n- Thin evidence: say so. Do not invent drama.'
                 || '\n\nVOICE'
                 || '\n- Editorial, dry, literary. Short sentences.'
                 || '\n- Unsparing, not cruel. Confident, not hyperbolic.'
                 || '\n- Banned: praise, hype, emoji, exclamation marks, markdown, asterisks.'
                 || '\n- Plain text only. The renderer applies all styling.'
                 || '\n\nTHE CARD'
                 || '\nA scatter plot of every commit: date across, hour of day down, night at the '
                 || 'bottom. The renderer pins labels to fixed anchors on that plot and derives '
                 || 'every fact — commit counts, timestamps, gap dates, status verbs, the caption — '
                 || 'from the supplied values. You write only the words the reader hears in the '
                 || 'author''s voice: the genre, the headline, and the poetic tail on each anchor.'
                 || '\nThe storyline decides the register. The same dark stretch is a grave to a '
                 || 'collapse and a runway to a resurrection. Read it accordingly.'
                 || '\n\nACCENT COLOUR'
                 || '\n- One colour paints every accent-coloured element on the card: kicker slug, '
                 || 'italic headline fragment, last-commit dot, arrow, void-panel rule, attribution '
                 || 'bullet. Pick it accordingly.'
                 || '\n- A project that burned out and one that came back and shipped must not share '
                 || 'a colour. Blue is not a default.'
                 || '\n\nFIELDS'
                 || '\n- kicker: names the genre in plain English, lowercase, max 40 chars. The '
                 || 'storyline keyword is an internal label, not an answer; returning "nocturne" or '
                 || '"resurrection" is echoing the input.'
                 || '\n- headline_upright: the text before the italic run. Max 45 chars. Upright.'
                 || '\n- headline_accent: the italic + accent-coloured fragment. Max 55 chars. This '
                 || 'is the line that gets screenshotted. The italic run may sit mid-sentence — it '
                 || 'is a fragment, not a whole clause.'
                 || '\n- headline_trail: the text after the italic run, usually empty or a single '
                 || 'punctuation mark. Max 5 chars. Upright. Punctuation may live in accent OR '
                 || 'trail; put it wherever the typography looks right.'
                 || '\n- label_first: pinned to the first commit. The poetic tail only — the '
                 || 'renderer prints the time and date before it. Do not include numbers or dates. '
                 || 'Max 30 chars.'
                 || '\n- label_pivot: pinned to pivot_at, the moment this storyline turns. Poetic '
                 || 'tail only. Max 30 chars. Empty string if pivot_at is empty or equals '
                 || 'last_commit_at (the renderer will not draw a second label on the last dot).'
                 || '\n- label_last: pinned to the final commit. Poetic tail only. Max 30 chars. '
                 || 'Empty string unless status is "active" — for abandoned or dormant repos the '
                 || 'renderer prints "last commit \u00b7 <time>" and adding a tail on top reads as '
                 || 'filler. When active, this is the latest word, e.g. "still rewriting".'
                 || '\n- accent: #rrggbb. See ACCENT COLOUR above.'
                 || '\n- accent_reason: colour name and why, max 60 chars.'
                 || '\n\nFIELD LIMITS (recap)'
                 || '\n  kicker \u2264 40 \u00b7 headline_upright \u2264 45 \u00b7 headline_accent \u2264 55 \u00b7 '
                 || 'headline_trail \u2264 5 \u00b7 label_first \u2264 30 \u00b7 label_pivot \u2264 30 \u00b7 '
                 || 'label_last \u2264 30 \u00b7 accent_reason \u2264 60'
                 || '\n\nSTYLE REFERENCE (shape only, never reuse this wording; describes a repo '
                 || 'unlike the input)'
                 || '\n  Example 1 — punctuation lives inside accent:'
                 || '\n    kicker: the refactor that ate a summer'
                 || '\n    headline_upright: It was rebuilt beautifully. It never once ran'
                 || '\n    headline_accent: in production.'
                 || '\n    headline_trail: (empty)'
                 || '\n  Example 2 — punctuation lives inside trail:'
                 || '\n    kicker: the death of a side project'
                 || '\n    headline_upright: Born in daylight. Last touched at'
                 || '\n    headline_accent: 3:53 in the morning'
                 || '\n    headline_trail: .'
                 || '\n  Anchor labels (poetic tails, no facts):'
                 || '\n    label_first: it begins'
                 || '\n    label_pivot: the fourth rewrite   (empty for a collapse)'
                 || '\n    label_last: still rewriting        (empty unless active)'
                 || '\n    accent: #8a6d3b, rust, for something that oxidised in place'
            ),
            OBJECT_CONSTRUCT(
                'role', 'user',
                'content',
                    'Storyline: '                                       || STORYLINE
                 || '\nStatus: '                                        || STATUS
                 || '\nTotal commits: '                                 || TOTAL_COMMITS
                 || '\nOf those, authored at night (22:00-04:59 UTC): ' || NIGHT_COMMITS
                 || '\nOf those, naming an AI tool: '                   || AI_ASSISTED_COMMITS
                 || '\nDistinct authors: '                              || AUTHOR_COUNT
                 || '\nDays with at least one commit: '                 || ACTIVE_DAYS
                 || '\nDays from first commit to last: '                || SPAN_DAYS
                 || '\nDays since the most recent commit: '             || DAYS_SINCE_LAST
                 || '\nFirst commit at: '                               || FIRST_COMMIT_AT
                 || '\nFirst commit message: '                          || COALESCE(FIRST_COMMIT_SUBJECT, '')
                 || '\nLast commit at: '                                || LAST_COMMIT_AT
                 || '\nLast commit message: '                           || COALESCE(LAST_COMMIT_SUBJECT, '')
                 || '\nPivot (the moment this storyline turns): '       || COALESCE(PIVOT_AT, '')
                 || '\nLongest silence, in days: '                      || COALESCE(GAP_DAYS, '')
                 || '\nLongest silence, from: '                         || COALESCE(GAP_FROM, '')
                 || '\nLongest silence, to: '                           || COALESCE(GAP_TO, '')
                 || '\nEvidence for this storyline: '                   || EVIDENCE
                 || '\nCommit messages from the winning thread: '       || COMMITS
            )
        ),
        model_parameters => {'temperature': 0, 'max_tokens': 2048},
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
