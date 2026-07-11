import type { RepoSlug } from '../shared/slug.js';

export type JobStatus = 'unknown' | 'generating' | 'ready' | 'failed';

export interface JobState {
  status: JobStatus;
  repo: string;
  accent?: string;
  generatedAt?: string;
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
 * Ask for a generation. The response is the job's state, not the card: generation is
 * durable and outlives this tab, so the page attaches to it by polling rather than
 * holding a request open.
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

export async function fetchState(slug: RepoSlug): Promise<JobState> {
  const response = await fetch(`/api/state/${slug.owner}/${slug.repo}`);
  if (!response.ok) throw new Error(`state failed: ${response.status}`);
  return (await response.json()) as JobState;
}

export function cardUrl(slug: RepoSlug): string {
  return `/${slug.owner}/${slug.repo}/card.svg`;
}

export function embedMarkdown(slug: RepoSlug, origin: string): string {
  const page = `${origin}/${slug.slug}`;
  return `[![Commit Chronicle](${page}/card.svg)](${page})`;
}
