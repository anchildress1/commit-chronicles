-- Commit Chronicles — the Cortex function
--
-- One registered AI function, built with Cortex AI Function Studio
-- (SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION). It lives in this file and deploys with the
-- snow CLI — not something clicked into existence in Snowsight.
--
-- CREATE_AI_FUNCTION generates a UDF wrapping AI_COMPLETE with a system prompt, a
-- {placeholder} user template, and a response_format derived from OUTPUTS. Declaring
-- several output fields yields one structured JSON object from a single call (a lone
-- field is unwrapped to a scalar instead). So the whole card is one Cortex round trip,
-- constrained by schema rather than parsed out of prose.
--
-- What Cortex reads is already rationed by the detector: the winning storyline's ~20
-- commits and its computed facts, never the whole history. That is the cost control,
-- and it happens before this function is ever called.
--
-- Inputs are concatenated as text, so JSON slices arrive via TO_JSON().

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CHRONICLES_WH;
USE SCHEMA CHRONICLES.RAW;

-- Superseded by CHRONICLE_CARD: four separate calls where one structured call does.
DROP FUNCTION IF EXISTS CHRONICLE_KICKER(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_HEADLINE(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_THESIS(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_ACCENT(VARCHAR, VARCHAR, VARCHAR);

-- CREATE_AI_FUNCTION has no OR REPLACE. Without this drop, redeploying leaves the OLD
-- prompt in place and the file lies about what is running — which cost an entire
-- debugging cycle already. Drop, then create.
--
-- Both signatures: the earlier build took a single facts blob (5 args). Snowflake
-- overloads on arity, so dropping only the current one would strand the old function
-- alive and callable.
DROP FUNCTION IF EXISTS CHRONICLE_CARD(VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS CHRONICLE_CARD(
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR,
    VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

-- The card, read off the winning thread in one constrained call.
--
-- On the examples below: each describes an arc that no test repo has. An example that
-- happens to be the right answer for a real repo gets parroted straight back, and then
-- you cannot tell whether the model read the history or copied the prompt.
CALL SNOWFLAKE.CORTEX.CREATE_AI_FUNCTION(
    'CHRONICLES.RAW.CHRONICLE_CARD',
    'claude-sonnet-4-5',
    'ROLE: editorial writer. Input is one storyline detected in a repo commit history, its '
    || 'computed facts, and the commit messages from that thread. Output is the card.'
    || '\n\nGROUNDING'
    || '\n- Use only supplied values.'
    || '\n- Never state a number that was not supplied.'
    || '\n- Never re-label a supplied number. total_commits and night_commits are different '
    || 'values; captioning one with the other''s label is a factual error.'
    || '\n- Observed: commits, timestamps, commit messages. Nothing else.'
    || '\n- Do not mention releases, users, production, deployments, reviews, tests, or whether '
    || 'anything worked, unless a supplied commit message says so.'
    || '\n- Do not state motivation or intent. Not observable.'
    || '\n- Thin evidence: say so. Do not invent drama.'
    || '\n\nTASK'
    || '\n- Interpret the shape of the history. Describing it is not enough; state what the arc means.'
    || '\n- Quote supplied commit messages verbatim where they carry the point.'
    || '\n\nVOICE'
    || '\n- Editorial, dry, literary. Short sentences.'
    || '\n- Unsparing, not cruel. Confident, not hyperbolic.'
    || '\n- Banned: praise, hype, emoji, exclamation marks, markdown, asterisks.'
    || '\n- Plain text only. The renderer applies all styling.'
    || '\n\nFIELDS'
    || '\n- kicker: names the genre in plain English. The storyline keyword is an internal label, '
    || 'not an answer; returning "nocturne" or "resurrection" is echoing the input.'
    || '\n- headline_lead: clause 1, set upright.'
    || '\n- headline_accent: clause 2, set italic and in the accent colour. This is the line that '
    || 'gets screenshotted.'
    || '\n- thesis: one sentence reading the arc. An inventory of the work is not a thesis.'
    || '\n- accent: #rrggbb, chosen to fit this arc. A project that burned out and one that came '
    || 'back and shipped must not share a colour. Blue is not a default.'
    || '\n- accent_reason: colour name and why.'
    || '\n\nSTYLE REFERENCE (shape only, never reuse this wording; describes a repo unlike the input)'
    || '\n  kicker: the refactor that ate a summer'
    || '\n  headline: It was rebuilt beautifully. / It never once ran in production.'
    || '\n  thesis: Every commit was a fresh start, which is another way of saying none finished.'
    || '\n  accent: #8a6d3b, rust, for something that oxidised in place',
    -- Each number arrives as its own input and is labelled here, in the prompt template,
    -- rather than as one JSON blob. Handed {"commitCount":56,"nightCommits":47} the model
    -- wrote "fifty-six commits after midnight" — it read an adjacent integer and captioned
    -- it wrong. Labelling belongs in the template; the SQL layer passes values, not prose.
    'Storyline: {storyline}'
    || '\nStatus: {status}'
    || '\nTotal commits: {total_commits}'
    || '\nOf those, commits authored at night (22:00-04:59 UTC): {night_commits}'
    || '\nOf those, commits naming an AI tool: {ai_assisted_commits}'
    || '\nDistinct authors: {author_count}'
    || '\nDays with at least one commit: {active_days}'
    || '\nDays from first commit to last: {span_days}'
    || '\nDays since the most recent commit: {days_since_last}'
    || '\nFirst commit at: {first_commit_at}'
    || '\nLast commit at: {last_commit_at}'
    || '\nEvidence for this storyline: {evidence}'
    || '\nCommit messages from the winning thread: {commits}',
    [ {'name': 'storyline',           'type': 'string'},
      {'name': 'status',              'type': 'string'},
      {'name': 'total_commits',       'type': 'string'},
      {'name': 'night_commits',       'type': 'string'},
      {'name': 'ai_assisted_commits', 'type': 'string'},
      {'name': 'author_count',        'type': 'string'},
      {'name': 'active_days',         'type': 'string'},
      {'name': 'span_days',           'type': 'string'},
      {'name': 'days_since_last',     'type': 'string'},
      {'name': 'first_commit_at',     'type': 'string'},
      {'name': 'last_commit_at',      'type': 'string'},
      {'name': 'evidence',            'type': 'string'},
      {'name': 'commits',             'type': 'string'} ],
    [ {'name': 'kicker',          'type': 'string', 'description': 'lowercase phrase naming the genre of the story in plain English, max 40 chars; must NOT be the storyline keyword itself'},
      {'name': 'headline_lead',   'type': 'string', 'description': 'first headline clause, set upright, max 40 chars'},
      {'name': 'headline_accent', 'type': 'string', 'description': 'second headline clause, set italic and in the accent colour, max 55 chars'},
      {'name': 'thesis',          'type': 'string', 'description': 'one sentence reading the shape of the history, max 120 chars; not an inventory of the work'},
      {'name': 'accent',          'type': 'string', 'description': 'hex colour of the form #rrggbb, chosen to read the arc'},
      {'name': 'accent_reason',   'type': 'string', 'description': 'a few words naming the colour and why, max 60 chars'} ],
    'Read the one storyline in a repository history and write its card: genre, headline, thesis, and accent colour.',
    NULL, NULL
);

-- No smoke test here on purpose. Invoking this function costs Cortex tokens; a card is
-- generated once, through READ_REPO, on a real cache miss. It is not a thing to poke at.
