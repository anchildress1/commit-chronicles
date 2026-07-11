-- Commit Chronicles — the Cortex function
--
-- CHRONICLE_CARD is a plain SQL UDF wrapping AI_COMPLETE. One call, one
-- schema-constrained JSON object, nothing to parse out of prose.
--
-- Written by hand rather than through Cortex AI Function Studio, on purpose. The Studio
-- registers functions via SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION, and the docs are explicit
-- that those procedures "are not intended to be called directly" and that their
-- "signatures and behavior may change without notice". Its supported front doors are the
-- Snowsight wizard and the Cortex Code CLI — and a function clicked into existence in a
-- UI is not in this repo, which the spec forbids.
--
-- So: neither. CREATE_AI_FUNCTION emits an ordinary UDF around AI_COMPLETE — there is no
-- privileged machinery inside it — and that is written out directly below. Public API,
-- stable contract, source of truth in git, and CREATE OR REPLACE actually works (the
-- Studio procedure has no OR REPLACE, which already cost one debugging cycle where a
-- redeploy silently kept the old prompt).
--
-- What Cortex reads is rationed by the detector, not here: it sees the winning
-- storyline's ~20 commits and the computed facts, never the whole history.

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- Registered by the Studio in earlier builds. Both arities, because Snowflake overloads
-- on arity and a stale signature would stay alive and callable.
DROP FUNCTION IF EXISTS CHRONICLE_KICKER(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_HEADLINE(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_THESIS(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_ACCENT(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_CARD(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

-- Each fact arrives as its own argument and is labelled in the user message. Handed a
-- single JSON blob the model read an adjacent integer and captioned it wrong, writing
-- "fifty-six commits after midnight" when 56 was the total and 47 was the night count.
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
        model_parameters => {'temperature': 0, 'max_tokens': 1024},
        -- Generous ceiling on purpose: a structured response that hits max_tokens comes
        -- back NULL instead of raising, so a stingy budget is indistinguishable from an
        -- outage. READ_REPO treats a NULL narration as a hard failure.
        response_format => PARSE_JSON('{
            "type": "json",
            "schema": {
                "type": "object",
                "properties": {
                    "kicker":          {"type": "string", "maxLength": 40},
                    "headline_lead":   {"type": "string", "maxLength": 40},
                    "headline_accent": {"type": "string", "maxLength": 55},
                    "thesis":          {"type": "string", "maxLength": 120},
                    "accent":          {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
                    "accent_reason":   {"type": "string", "maxLength": 60}
                },
                "required": ["kicker", "headline_lead", "headline_accent",
                             "thesis", "accent", "accent_reason"],
                "additionalProperties": false
            }
        }')
    )
$$;

-- No smoke test here on purpose. Invoking this costs Cortex tokens; a card is generated
-- once, through READ_REPO, on a real cache miss. It is not a thing to poke at.
