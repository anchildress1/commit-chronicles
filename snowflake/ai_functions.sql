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
                    'TASK'
                 || '\nCompose the writing on a repo-story card. One repo, one storyline, nine text '
                 || 'fields. Return JSON matching response_format.'
                 || '\n\nOUTPUT FIELDS (semantics; limits are advisory, response_format enforces types)'
                 || '\n  kicker           <=40  lowercase plain-English genre. NOT the storyline keyword.'
                 || '\n  headline_upright <=45  text before the italic run. Upright.'
                 || '\n  headline_accent  <=55  italic + accent-coloured fragment. The screenshot line.'
                 || '\n  headline_trail   <=5   text after italic run. Usually "" or ".".'
                 || '\n  label_first      <=30  poetic tail on the first-commit anchor.'
                 || '\n  label_pivot      <=30  poetic tail on the pivot anchor.'
                 || '\n  label_last       <=30  poetic tail on the last-commit anchor.'
                 || '\n  accent           7     "#rrggbb" from PALETTE.'
                 || '\n  accent_reason    <=60  colour name + one-clause justification.'
                 || '\n\nGROUNDING'
                 || '\n- Use only supplied values. Never state a number that was not supplied.'
                 || '\n- Never re-label a supplied number. total_commits, night_commits, and '
                 || 'ai_assisted_commits are distinct; swapping labels is a factual error.'
                 || '\n- Observable set = commits, timestamps, commit messages. Do not mention '
                 || 'releases, users, production, deployments, reviews, tests, motivation, or '
                 || 'intent unless a supplied commit message names them.'
                 || '\n- Thin evidence -> say so. Do not invent drama.'
                 || '\n\nVOICE'
                 || '\n- Editorial, dry, literary. Short sentences.'
                 || '\n- Unsparing not cruel. Confident not hyperbolic.'
                 || '\n- BANNED tokens in output: praise words, hype, emoji, "!", markdown, "*", "_".'
                 || '\n- Plain text only. Renderer applies all styling.'
                 || '\n\nHEADLINE RULES'
                 || '\n- The italic run MAY sit mid-sentence. It is a fragment, not required to be a '
                 || 'whole clause.'
                 || '\n- Punctuation may live in headline_accent OR headline_trail. Choose so the '
                 || 'typography reads right.'
                 || '\n- headline_accent is the memorable line. Make it earn that slot.'
                 || '\n\nANCHOR LABEL RULES'
                 || '\n- label_first, label_pivot, label_last are POETIC TAILS ONLY. No digits, no '
                 || 'timestamps, no dates, no commit counts. The renderer prints the facts and '
                 || 'appends the tail.'
                 || '\n- label_pivot = "" when input pivot_at="" OR pivot_at==last_commit_at.'
                 || '\n- label_last  = "" unless input status=="active".'
                 || '\n- Register shifts by storyline. Same dark stretch reads as a grave to a '
                 || 'collapse and a runway to a resurrection.'
                 || '\n\nACCENT COLOUR'
                 || '\n- One hex paints every accent-coloured element on the card (kicker slug, '
                 || 'italic headline fragment, last-commit dot, arrow, void-panel rule, attribution '
                 || 'bullet). Choose accordingly.'
                 || '\n- PALETTE = muted neons. Pick at or near an anchor. Drift off-anchor is OK; '
                 || 'leaving the family is not.'
                 || '\n    #e8a04a  amber   burn / heat / ember'
                 || '\n    #e56b5a  coral   conflict / alarm / warning'
                 || '\n    #d3e85a  lime    return / growth / life'
                 || '\n    #7fe4c5  mint    cool / dawn / calm'
                 || '\n    #6ab5f5  sky     night / distance / quiet'
                 || '\n- BANNED colours: greys, browns, fluorescents, deep saturated primaries.'
                 || '\n- A burned-out repo and a shipped-return repo MUST NOT share a colour.'
                 || '\n\nEXAMPLES (shape only; do NOT reuse this wording)'
                 || '\nex1 = active repo; whole-clause italic; punctuation in accent:'
                 || '\n{"kicker":"the refactor that ate a summer",'
                 || '"headline_upright":"It was rebuilt beautifully.",'
                 || '"headline_accent":"It never once ran in production.",'
                 || '"headline_trail":"",'
                 || '"label_first":"the first rewrite",'
                 || '"label_pivot":"the fourth rewrite",'
                 || '"label_last":"still rewriting",'
                 || '"accent":"#e56b5a",'
                 || '"accent_reason":"coral, for something rebuilt but never once run"}'
                 || '\nex2 = collapse; mid-sentence italic fragment; punctuation in trail:'
                 || '\n{"kicker":"the death of a side project",'
                 || '"headline_upright":"Born in daylight. Last touched at",'
                 || '"headline_accent":"3:53 in the morning",'
                 || '"headline_trail":".",'
                 || '"label_first":"it begins",'
                 || '"label_pivot":"",'
                 || '"label_last":"",'
                 || '"accent":"#e8a04a",'
                 || '"accent_reason":"amber, for a repo that ran hot and went out"}'
            ),
            OBJECT_CONSTRUCT(
                'role', 'user',
                'content',
                    'storyline='             || STORYLINE
                 || '\nstatus='               || STATUS
                 || '\ntotal_commits='        || TOTAL_COMMITS
                 || '\nnight_commits='        || NIGHT_COMMITS       || '  (22:00-04:59 UTC)'
                 || '\nai_assisted_commits='  || AI_ASSISTED_COMMITS  || '  (subject/body names an AI tool)'
                 || '\nauthor_count='         || AUTHOR_COUNT
                 || '\nactive_days='          || ACTIVE_DAYS
                 || '\nspan_days='            || SPAN_DAYS            || '  (first commit to last)'
                 || '\ndays_since_last='      || DAYS_SINCE_LAST
                 || '\nfirst_commit_at='      || FIRST_COMMIT_AT
                 || '\nfirst_commit_subject=' || COALESCE(FIRST_COMMIT_SUBJECT, '')
                 || '\nlast_commit_at='       || LAST_COMMIT_AT
                 || '\nlast_commit_subject='  || COALESCE(LAST_COMMIT_SUBJECT, '')
                 || '\npivot_at='             || COALESCE(PIVOT_AT, '')   || '  (moment this storyline turns; "" = not applicable)'
                 || '\ngap_days='             || COALESCE(GAP_DAYS, '')   || '  (longest silence)'
                 || '\ngap_from='             || COALESCE(GAP_FROM, '')
                 || '\ngap_to='               || COALESCE(GAP_TO, '')
                 || '\nevidence='             || EVIDENCE                 || '  (JSON; storyline-specific signals)'
                 || '\ncommits='              || COMMITS                  || '  (JSON array; the winning thread)'
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
