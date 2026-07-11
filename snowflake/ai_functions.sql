-- Commit Chronicles — CHRONICLE_CARD. Wraps AI_COMPLETE; one schema-constrained call.
--
-- Not built with Cortex AI Function Studio: it registers via
-- SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION, which the docs mark internal, not for direct
-- calls, and subject to change without notice.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- Studio-registered functions from earlier builds. Snowflake overloads on arity.
DROP FUNCTION IF EXISTS CHRONICLE_KICKER(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_HEADLINE(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_THESIS(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_ACCENT(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_CARD(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

-- Facts pass as discrete args, not one JSON blob: the model mislabels adjacent integers.
CREATE OR REPLACE FUNCTION CHRONICLE_CARD(
    STORYLINE           VARCHAR,
    STATUS              VARCHAR,
    TOTAL_COMMITS       VARCHAR,
    NIGHT_COMMITS       VARCHAR,
    AI_ASSISTED_COMMITS VARCHAR,
    AUTHOR_COUNT        VARCHAR,
    ACTIVE_DAYS         VARCHAR,
    SPAN_DAYS           VARCHAR,
    DAYS_SINCE_LAST     VARCHAR,
    FIRST_COMMIT_AT     VARCHAR,
    LAST_COMMIT_AT      VARCHAR,
    EVIDENCE            VARCHAR,
    COMMITS             VARCHAR
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
                    'ROLE: editorial writer. Input is one storyline detected in a repo commit '
                 || 'history, its computed facts, and the commit messages from that thread. '
                 || 'Output is the card.'
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
                 || '\n\nTASK'
                 || '\n- Interpret the shape of the history. Describing it is not enough; state what '
                 || 'the arc means.'
                 || '\n- Quote supplied commit messages verbatim where they carry the point.'
                 || '\n\nVOICE'
                 || '\n- Editorial, dry, literary. Short sentences.'
                 || '\n- Unsparing, not cruel. Confident, not hyperbolic.'
                 || '\n- Banned: praise, hype, emoji, exclamation marks, markdown, asterisks.'
                 || '\n- Plain text only. The renderer applies all styling.'
                 || '\n\nFIELDS'
                 || '\n- kicker: names the genre in plain English, lowercase, max 40 chars. The '
                 || 'storyline keyword is an internal label, not an answer; returning "nocturne" or '
                 || '"resurrection" is echoing the input.'
                 || '\n- headline_lead: clause 1, set upright, max 40 chars.'
                 || '\n- headline_accent: clause 2, set italic and in the accent colour, max 55 '
                 || 'chars. This is the line that gets screenshotted.'
                 || '\n- thesis: one sentence reading the arc, max 120 chars. An inventory of the '
                 || 'work is not a thesis.'
                 || '\n- accent: #rrggbb, chosen to fit this arc. A project that burned out and one '
                 || 'that came back and shipped must not share a colour. Blue is not a default.'
                 || '\n- accent_reason: colour name and why, max 60 chars.'
                 || '\n\nSTYLE REFERENCE (shape only, never reuse this wording; describes a repo '
                 || 'unlike the input)'
                 || '\n  kicker: the refactor that ate a summer'
                 || '\n  headline: It was rebuilt beautifully. / It never once ran in production.'
                 || '\n  thesis: Every commit was a fresh start, which is another way of saying none finished.'
                 || '\n  accent: #8a6d3b, rust, for something that oxidised in place'
            ),
            OBJECT_CONSTRUCT(
                'role', 'user',
                'content',
                    'Storyline: '                                   || STORYLINE
                 || '\nStatus: '                                    || STATUS
                 || '\nTotal commits: '                             || TOTAL_COMMITS
                 || '\nOf those, authored at night (22:00-04:59 UTC): ' || NIGHT_COMMITS
                 || '\nOf those, naming an AI tool: '               || AI_ASSISTED_COMMITS
                 || '\nDistinct authors: '                          || AUTHOR_COUNT
                 || '\nDays with at least one commit: '             || ACTIVE_DAYS
                 || '\nDays from first commit to last: '            || SPAN_DAYS
                 || '\nDays since the most recent commit: '         || DAYS_SINCE_LAST
                 || '\nFirst commit at: '                           || FIRST_COMMIT_AT
                 || '\nLast commit at: '                            || LAST_COMMIT_AT
                 || '\nEvidence for this storyline: '               || EVIDENCE
                 || '\nCommit messages from the winning thread: '   || COMMITS
            )
        ),
        -- Hitting max_tokens returns NULL, not an error. Keep the ceiling loose.
        model_parameters => {'temperature': 0, 'max_tokens': 1024},
        -- No maxLength or pattern: unsupported by constrained decoding, and inside a UDF
        -- the schema rejection surfaces as NULL, not an error. Lengths live in the prompt.
        response_format => PARSE_JSON('{
            "type": "json",
            "schema": {
                "type": "object",
                "properties": {
                    "kicker":          {"type": "string"},
                    "headline_lead":   {"type": "string"},
                    "headline_accent": {"type": "string"},
                    "thesis":          {"type": "string"},
                    "accent":          {"type": "string"},
                    "accent_reason":   {"type": "string"}
                },
                "required": ["kicker", "headline_lead", "headline_accent",
                             "thesis", "accent", "accent_reason"],
                "additionalProperties": false
            }
        }')
    )
$$;

