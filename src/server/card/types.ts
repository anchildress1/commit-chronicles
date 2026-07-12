/**
 * The contract returned by Snowflake's `READ_REPO(owner, repo)` procedure.
 *
 * Snowflake owns every value here. The renderer composes the card from `facts`,
 * `statusLabel`, `pivotAt` and `plot`; the writing and the accent colour come from
 * Cortex. Nothing on the card is invented on this side of the wire.
 */

export interface LargestGap {
  days: number;
  from: string;
  to: string;
}

export interface CardFacts {
  commitCount: number;
  authorCount: number;
  primaryAuthor: string;
  primaryAuthorLogin: string | null;
  activeDays: number;
  spanDays: number;
  daysSinceLast: number;
  nightCommits: number;
  aiAssistedCommits: number;
  firstCommitAt: string;
  firstCommitSubject: string;
  lastCommitAt: string;
  lastCommitSubject: string;
  /** True when the history was longer than the ingest cap and only its newest slice was read. */
  windowed: boolean;
  largestGap: LargestGap | null;
}

/** One commit, positioned by the hour it landed. `n` is Snowflake's night flag. */
export interface PlotPoint {
  t: string;
  d: string;
  h: number;
  m: number;
  n: boolean;
}

export type RepoStatus = 'abandoned' | 'dormant' | 'active';

export type Storyline =
  'relapse' | 'nocturne' | 'binge' | 'collapse' | 'fight' | 'resurrection' | 'none';

export interface CardPayload {
  status: 'ready';
  repo: string;
  storyline: Storyline;
  score: number;
  statusLabel: RepoStatus;
  kicker: string;
  headlineUpright: string;
  headlineAccent: string;
  headlineTrail: string;
  labelFirst: string;
  labelPivot: string;
  labelLast: string;
  accent: string;
  accentReason: string;
  pivotAt: string | null;
  facts: CardFacts;
  evidence: Record<string, unknown>;
  plot: PlotPoint[];
  model: string;
  cortexQueryId: string | null;
  /** Hash of the prompt and evidence view that wrote this card. Moves when either does. */
  pipelineVersion: string | null;
  generatedAt: string;
}

export interface FailedPayload {
  status: 'failed';
  repo: string;
  errorCode: string;
  reasons?: string[];
}

export type ReadRepoResult = CardPayload | FailedPayload;

export function isCardPayload(result: ReadRepoResult): result is CardPayload {
  return result.status === 'ready';
}
