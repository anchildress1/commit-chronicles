import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuotaExceededError,
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
    mockFetch(200, { status: 'ready', repo: 'atlas/pipeline' });

    await expect(fetchState(SLUG)).resolves.toMatchObject({ status: 'ready' });
  });

  it('throws when the state endpoint fails', async () => {
    mockFetch(503, {});

    await expect(fetchState(SLUG)).rejects.toThrow(/state failed: 503/);
  });
});

describe('embedMarkdown', () => {
  const CARD = 'https://storage.googleapis.com/cc-cards/cards/atlas/pipeline/card.svg';
  const PAGE = 'https://commitchronicles.dev/atlas/pipeline';

  it('points the image at the bucket and the link at the page', () => {
    expect(embedMarkdown(CARD, PAGE)).toBe(`[![Commit Chronicles](${CARD})](${PAGE})`);
  });

  it('keeps the site out of the image path, so a README view is never billed', () => {
    const image = /!\[Commit Chronicles\]\(([^)]+)\)/.exec(embedMarkdown(CARD, PAGE))?.[1];

    expect(image).toBe(CARD);
    expect(image).not.toContain('commitchronicles.dev');
  });

  it('never links a README at the origin the author happened to be on', () => {
    // window.location.origin here is localhost. A README carrying that is a dead link.
    expect(embedMarkdown(CARD, PAGE)).not.toContain('localhost');
  });
});
