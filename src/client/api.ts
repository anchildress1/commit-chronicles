import type { RepoSlug } from '../shared/slug.js';

export type JobStatus = 'unknown' | 'generating' | 'ready' | 'failed';

export interface JobState {
  status: JobStatus;
  repo: string;
  /** The colour Cortex chose for this repo's card. Present once the card exists. */
  accent?: string;
  /** The card's public bucket URL. Present once the card exists. */
  cardUrl?: string;
  startedAt?: string;
  errorCode?: string;
  reasons?: string[];
}

export class QuotaExceededError extends Error {
  constructor() {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
  }
}

/**
 * Ask for a generation.
 *
 * @returns The job's state, not the card: generation outlives this tab, so the page
 *   attaches by polling rather than by holding a request open.
 * @throws {QuotaExceededError} When the day's budget is spent.
 */
export async function requestGeneration(slug: RepoSlug): Promise<JobState> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: slug.slug }),
  });

  if (response.status === 429) throw new QuotaExceededError();
  if (!response.ok) throw new Error(`generate failed: ${response.status}`);

  return (await response.json()) as JobState;
}

/**
 * Read the current state of a repo's job.
 *
 * @throws {Error} When the endpoint answers with anything but 200.
 */
export async function fetchState(slug: RepoSlug): Promise<JobState> {
  const response = await fetch(`/api/state/${slug.owner}/${slug.repo}`);
  if (!response.ok) throw new Error(`state failed: ${response.status}`);
  return (await response.json()) as JobState;
}

/**
 * The README embed: the card image, linking back to the repo's page.
 *
 * The image comes straight from the public bucket, so a README view costs nothing to serve.
 * Only the link lands on the site.
 *
 * @param cardUrl The bucket URL from the ready state — the client cannot derive it.
 */
export function embedMarkdown(slug: RepoSlug, origin: string, cardUrl: string): string {
  const page = `${origin}/${slug.slug}`;
  return `[![Commit Chronicle](${cardUrl})](${page})`;
}
