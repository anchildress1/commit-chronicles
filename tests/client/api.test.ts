import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuotaExceededError,
  cardUrl,
  embedMarkdown,
  fetchState,
  requestGeneration,
} from '../../src/client/api.js';
import { parseSlug } from '../../src/shared/slug.js';

const SLUG = parseSlug('atlas/pipeline');

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestGeneration', () => {
  it('returns the job state the server reports', async () => {
    mockFetch(202, { status: 'generating', repo: 'atlas/pipeline' });

    await expect(requestGeneration(SLUG)).resolves.toMatchObject({ status: 'generating' });
  });

  it('surfaces the quota cap as its own error, not a generic failure', async () => {
    mockFetch(429, { error: 'quota_exceeded' });

    await expect(requestGeneration(SLUG)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('throws on any other failure', async () => {
    mockFetch(500, { error: 'boom' });

    await expect(requestGeneration(SLUG)).rejects.toThrow(/generate failed: 500/);
  });
});

describe('fetchState', () => {
  it('reads the state', async () => {
    mockFetch(200, { status: 'ready', repo: 'atlas/pipeline', accent: '#e8a04a' });

    await expect(fetchState(SLUG)).resolves.toMatchObject({ accent: '#e8a04a' });
  });

  it('throws when the state endpoint fails', async () => {
    mockFetch(503, {});

    await expect(fetchState(SLUG)).rejects.toThrow(/state failed: 503/);
  });
});

describe('cardUrl', () => {
  it('points at the served card', () => {
    expect(cardUrl(SLUG)).toBe('/atlas/pipeline/card.svg');
  });
});

describe('embedMarkdown', () => {
  it('produces a README embed that links back to the page', () => {
    expect(embedMarkdown(SLUG, 'https://commitchronicles.dev')).toBe(
      '[![Commit Chronicle](https://commitchronicles.dev/atlas/pipeline/card.svg)](https://commitchronicles.dev/atlas/pipeline)',
    );
  });
});
