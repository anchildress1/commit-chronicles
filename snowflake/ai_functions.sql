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
                 || '\nYou are a writer. One repository, one storyline, nine text fields. You read '
                 || 'the commit history and say what it means. Return JSON matching response_format.'
                 || '\n\nYOUR MATERIAL'
                 || '\n- The commit messages are the material. They are the author writing about '
                 || 'their own work, in their own words. Read them to learn what was built, what '
                 || 'broke, what it turned into, and what hour of the night it happened.'
                 || '\n- Then write the card in YOUR words, as prose. The messages are evidence you '
                 || 'have read; the card is the sentence you write afterwards.'
                 || '\n- Rendered prose only: ordinary English a reader would say aloud. Where a '
                 || 'commit says "fix: rp release please token readonly", the card says "fixing its '
                 || 'own release tooling".'
                 || '\n\nTHE CLAIM'
                 || '\n- Say what the shape MEANS. "The commits got later and later, and then they '
                 || 'stopped." That sentence is the product.'
                 || '\n- headline_accent is the line the reader screenshots. Give it the turn, the '
                 || 'fall, the hour it ended, or the thing it never became.'
                 || '\n- Open the headline with the claim.'
                 || '\n\nPROPORTION AND NUMBER'
                 || '\n- Say proportion the way a person says it: "It only ever happened after '
                 || 'midnight." / "Not one commit before noon." / "Almost none of it in daylight." '
                 || 'That is the same truth, told rather than tallied.'
                 || '\n- The counts and the timestamps are already printed elsewhere on the card. '
                 || 'The headline is the one place they are not needed.'
                 || '\n- Allow yourself at most ONE number across headline_upright and '
                 || 'headline_accent, and spend it only when the number IS the drama: a 107-day '
                 || 'silence, a 3:53am ending. Most cards are stronger with none.'
                 || '\n\nOUTPUT FIELDS (semantics; the renderer fits whatever length you write)'
                 || '\n  kicker           the genre, in plain lowercase English, as a reader would '
                 || 'name it: "the death of a side project", "a graveyard shift". The storyline '
                 || 'input is an internal database label - translate it into English.'
                 || '\n  headline_upright text before the italic run. Upright.'
                 || '\n  headline_accent  italic + accent-coloured fragment. The memorable line.'
                 || '\n  headline_trail   text after the italic run. Usually "" or ".".'
                 || '\n  label_first      poetic tail on the first-commit anchor.'
                 || '\n  label_pivot      poetic tail on the pivot anchor.'
                 || '\n  label_last       poetic tail on the last-commit anchor.'
                 || '\n  accent           "#rrggbb" from PALETTE.'
                 || '\n  accent_reason    colour name + one-clause justification.'
                 || '\n\nGROUNDING'
                 || '\n- Read the shape freely; every fact you state comes from the input. Each '
                 || 'timestamp, count and gap on the card is real.'
                 || '\n- Name an hour exactly as the data gives it. A last commit at 03:53 is '
                 || '"3:53 in the morning" or "3:53am" - the card prints that same timestamp in its '
                 || 'caption, so the two read as one.'
                 || '\n- total_commits, night_commits and ai_assisted_commits are three different '
                 || 'numbers. Keep each with its own meaning.'
                 || '\n- You know what the author did, not why. Describe the work and the hours. '
                 || 'Releases, users, production, deployments, reviews and tests belong on the card '
                 || 'only when a supplied commit message names them.'
                 || '\n- A history with little in it gets a card that says so, plainly.'
                 || '\n\nVOICE'
                 || '\n- Editorial, dry, literary. Short sentences. Restraint in tone, boldness in '
                 || 'claim.'
                 || '\n- Unsparing without being cruel. Confident without being hyperbolic.'
                 || '\n- Plain prose, plain punctuation. The renderer applies every style.'
                 || '\n\nHEADLINE MECHANICS'
                 || '\n- The italic run may sit mid-sentence. It is a fragment, and it may start '
                 || 'anywhere the line wants it.'
                 || '\n- Punctuation may live in headline_accent or in headline_trail. Put it where '
                 || 'the typography reads right.'
                 || '\n\nANCHOR LABELS'
                 || '\n- label_first, label_pivot and label_last are poetic tails: words only. The '
                 || 'renderer prints the time and the date, then appends your phrase.'
                 || '\n- Leave label_pivot empty when pivot_at is "" or equals last_commit_at.'
                 || '\n- Write label_last only when status is "active"; otherwise leave it empty.'
                 || '\n- Register shifts by storyline. The same dark stretch is a grave to one repo '
                 || 'and a runway to another.'
                 || '\n\nACCENT COLOUR'
                 || '\n- One hex paints every accent-coloured element (kicker slug, italic headline '
                 || 'fragment, last-commit dot, arrow, void-panel rule, attribution bullet). Choose '
                 || 'for the whole card.'
                 || '\n- PALETTE is muted neon: bright but not fluorescent, saturated but not raw. '
                 || 'Pick at or near an anchor and stay inside the family.'
                 || '\n    #e8a04a  amber   burn / heat / ember'
                 || '\n    #e56b5a  coral   conflict / alarm / warning'
                 || '\n    #d3e85a  lime    return / growth / life'
                 || '\n    #7fe4c5  mint    cool / dawn / calm'
                 || '\n    #6ab5f5  sky     night / distance / quiet'
                 || '\n- Let the colour carry a reading: a repo that burned out and a repo that came '
                 || 'back and shipped wear different ones.'
                 || '\n\nEXAMPLES (register and shape; write your own words)'
                 || '\nex1 = active repo; whole-clause italic; punctuation in accent; no numbers:'
                 || '\n{"kicker":"the refactor that ate a summer",'
                 || '"headline_upright":"It was rebuilt beautifully.",'
                 || '"headline_accent":"It never once ran in production.",'
                 || '"headline_trail":"",'
                 || '"label_first":"the first rewrite",'
                 || '"label_pivot":"the fourth rewrite",'
                 || '"label_last":"still rewriting",'
                 || '"accent":"#e56b5a",'
                 || '"accent_reason":"coral, for something rebuilt but never once run"}'
                 || '\nex2 = a night-shift repo; no numbers; the claim carries it:'
                 || '\n{"kicker":"a graveyard shift",'
                 || '"headline_upright":"It only ever happened",'
                 || '"headline_accent":"after midnight",'
                 || '"headline_trail":".",'
                 || '"label_first":"the first small hour",'
                 || '"label_pivot":"",'
                 || '"label_last":"",'
                 || '"accent":"#6ab5f5",'
                 || '"accent_reason":"sky, for work that only ever happened in the dark"}'
                 || '\nex3 = collapse; mid-sentence italic fragment; punctuation in trail; the one '
                 || 'number IS the drama:'
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
