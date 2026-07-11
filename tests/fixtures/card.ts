import type { CardPayload, PlotPoint } from '../../src/server/card/types.js';

/** Snowflake renders TIMESTAMP_TZ like this. Every fixture timestamp must match the shape. */
export function ts(iso: string): string {
  return `${iso.replace('T', ' ')}.000 -0500`;
}

function point(iso: string): PlotPoint {
  const [date, time] = iso.split('T');
  const [hour, minute] = (time ?? '00:00:00').split(':');
  return {
    t: ts(iso),
    d: date ?? '',
    h: Number(hour),
    m: Number(minute),
    n: Number(hour) >= 22 || Number(hour) < 5,
  };
}

/** The collapse: born in daylight, died at 3:53am, with 38 days dark in the middle. */
export const DESCENT_PLOT: PlotPoint[] = [
  '2025-12-06T17:10:00',
  '2025-12-07T15:30:00',
  '2025-12-08T02:01:00',
  '2025-12-09T23:47:00',
  '2025-12-15T20:40:00',
  '2025-12-20T22:05:00',
  '2025-12-27T01:05:00',
  '2026-02-03T01:58:00',
  '2026-02-12T02:40:00',
  '2026-02-20T03:10:00',
  '2026-02-25T03:53:00',
].map(point);

export const CARD: CardPayload = {
  status: 'ready',
  repo: 'atlas/pipeline',
  storyline: 'collapse',
  score: 78,
  statusLabel: 'abandoned',
  kicker: 'the death of a side project',
  headlineUpright: 'Born in daylight. Last touched at',
  headlineAccent: '3:53 in the morning',
  headlineTrail: '.',
  labelFirst: 'it begins',
  labelPivot: '',
  labelLast: '',
  accent: '#e8a04a',
  accentReason: 'amber, for a repo that ran hot and went out',
  pivotAt: ts('2026-02-25T03:53:00'),
  facts: {
    commitCount: 59,
    authorCount: 1,
    primaryAuthor: 'Rhea Okonkwo',
    primaryAuthorLogin: 'rhea-okonkwo',
    activeDays: 24,
    spanDays: 81,
    daysSinceLast: 136,
    nightCommits: 41,
    aiAssistedCommits: 3,
    firstCommitAt: ts('2025-12-06T17:10:00'),
    firstCommitSubject: 'init',
    lastCommitAt: ts('2026-02-25T03:53:00'),
    lastCommitSubject: 'fix: rp my release please token readonly',
    largestGap: {
      days: 38,
      from: ts('2025-12-27T01:05:00'),
      to: ts('2026-02-03T01:58:00'),
    },
  },
  evidence: { daysSinceLastCommit: 136 },
  plot: DESCENT_PLOT,
  model: 'claude-sonnet-4-5',
  cortexQueryId: '01b2-0000-abcd',
  generatedAt: ts('2026-07-11T09:00:00'),
};

export function cardWith(overrides: Partial<CardPayload>): CardPayload {
  return { ...CARD, ...overrides };
}
