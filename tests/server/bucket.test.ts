import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardStore } from '../../src/server/bucket.js';
import { CARD } from '../fixtures/card.js';

// dev.to proxies remote images and will not serve an SVG, so the card is a PNG.
const PNG = Buffer.from('png');

/** A GCS error carries an HTTP status on `code`; the store branches on 404 and 412. */
class GcsError extends Error {
  constructor(readonly code: number) {
    super(`gcs ${String(code)}`);
  }
}

interface FakeObject {
  data: string;
  generation: number | string;
  custom: Record<string, string>;
}

/**
 * A GCS double that enforces the one behaviour the quota counter depends on:
 * `ifGenerationMatch` fails with 412 when the object moved underneath the writer.
 */
function fakeStorage(objects = new Map<string, FakeObject>()) {
  const saved: { path: string; contentType: string | undefined; cacheControl: unknown }[] = [];
  const downloads: string[] = [];

  const storage = {
    bucket: () => ({
      file: (path: string, options?: { generation?: string }) => ({
        download: () => {
          downloads.push(path);
          const object = objects.get(path);
          if (!object) return Promise.reject(new GcsError(404));
          if (options?.generation && options.generation !== String(object.generation)) {
            return Promise.reject(new GcsError(404));
          }
          return Promise.resolve([Buffer.from(object.data, 'utf8')]);
        },
        exists: () => Promise.resolve([objects.has(path)]),
        getMetadata: () => {
          const object = objects.get(path);
          if (!object) return Promise.reject(new GcsError(404));
          return Promise.resolve([{ generation: object.generation, metadata: object.custom }]);
        },
        save: (data: string | Buffer, options?: Record<string, unknown>) => {
          const expected = (
            options?.['preconditionOpts'] as { ifGenerationMatch?: number | string }
          )?.ifGenerationMatch;
          const current = objects.get(path)?.generation ?? 0;
          if (expected !== undefined && String(expected) !== String(current)) {
            return Promise.reject(new GcsError(412));
          }
          const metadata = options?.['metadata'] as
            { cacheControl?: unknown; metadata?: Record<string, string> } | undefined;
          objects.set(path, {
            data: typeof data === 'string' ? data : data.toString('utf8'),
            generation: String(BigInt(current) + 1n),
            custom: metadata?.metadata ?? {},
          });
          saved.push({
            path,
            contentType: options?.['contentType'] as string | undefined,
            cacheControl: metadata?.cacheControl,
          });
          return Promise.resolve();
        },
        delete: () => {
          if (!objects.delete(path)) return Promise.reject(new GcsError(404));
          return Promise.resolve();
        },
      }),
    }),
  };

  return { storage, objects, saved, downloads };
}

const store = (fake: ReturnType<typeof fakeStorage>) =>
  createCardStore('test-bucket', fake.storage as any);

describe('readState', () => {
  it('is unknown for a repo nobody has read', async () => {
    const fake = fakeStorage();
    await expect(store(fake).readState('atlas', 'pipeline')).resolves.toEqual({
      status: 'unknown',
      repo: 'atlas/pipeline',
    });
  });

  it('is ready when the card exists — existence is the whole signal', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);

    await expect(store(fake).readState('atlas', 'pipeline')).resolves.toEqual({
      status: 'ready',
      repo: 'atlas/pipeline',
      accent: CARD.accent,
      cardUrl: 'https://storage.googleapis.com/test-bucket/cards/atlas/pipeline/card.png',
    });
  });

  it('hands back the accent so the page can dress itself in the card’s colour', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, { ...CARD, accent: '#7fe4c5' });

    const state = await store(fake).readState('atlas', 'pipeline');
    expect(state).toMatchObject({ status: 'ready', accent: '#7fe4c5' });
  });

  it('falls back to grey rather than letting a junk accent reach the page', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, {
      ...CARD,
      accent: 'javascript:alert(1)',
    });

    const state = await store(fake).readState('atlas', 'pipeline');
    expect(state).toMatchObject({ status: 'ready', accent: '#6b7280' });
  });

  it('does not download the card just to learn that it exists', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);
    fake.downloads.length = 0;

    await store(fake).readState('atlas', 'pipeline');

    expect(fake.downloads).not.toContain('cards/atlas/pipeline/card.json');
  });

  it('lets a real card outrank a stale generating marker', async () => {
    const fake = fakeStorage();
    await store(fake).claimGenerating('atlas', 'pipeline');
    fake.objects.set('cards/atlas/pipeline/card.json', {
      data: JSON.stringify(CARD),
      generation: 1,
      custom: {},
    });

    await expect(store(fake).readState('atlas', 'pipeline')).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('reports a cached failure with its error code', async () => {
    const fake = fakeStorage();
    await store(fake).markFailed('atlas', 'pipeline', 'repo_not_found');

    await expect(store(fake).readState('atlas', 'pipeline')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'repo_not_found',
    });
  });

  it('propagates an error that is not a 404', async () => {
    const fake = fakeStorage();
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: () => ({
        download: () => Promise.reject(new GcsError(500)),
        getMetadata: () => Promise.reject(new GcsError(500)),
        exists: () => Promise.reject(new GcsError(500)),
        save: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }),
    });

    await expect(store(fake).readState('atlas', 'pipeline')).rejects.toThrow('gcs 500');
  });
});

describe('writeCard', () => {
  it('writes the image before the payload, so a crash leaves the repo retryable', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);

    expect(fake.saved.map((entry) => entry.path)).toEqual([
      'cards/atlas/pipeline/card.png',
      'cards/atlas/pipeline/card.json',
    ]);
  });

  it('serves the PNG with a cache header camo will honour', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);

    expect(fake.saved[0]).toMatchObject({
      contentType: 'image/png',
      cacheControl: 'public, max-age=3600',
    });
  });

  it('clears the generating marker once the card lands', async () => {
    const fake = fakeStorage();
    await store(fake).claimGenerating('atlas', 'pipeline');
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);

    expect(fake.objects.has('cards/atlas/pipeline/state.json')).toBe(false);
  });

  it('does not fail when there was no marker to clear', async () => {
    const fake = fakeStorage();
    await expect(store(fake).writeCard('atlas', 'pipeline', PNG, CARD)).resolves.toBeUndefined();
  });
});

describe('the card URL', () => {
  it('points readers at the public bucket, never at the service', async () => {
    const fake = fakeStorage();
    await store(fake).writeCard('atlas', 'pipeline', PNG, CARD);

    const state = await store(fake).readState('atlas', 'pipeline');

    expect(state).toMatchObject({
      status: 'ready',
      cardUrl: 'https://storage.googleapis.com/test-bucket/cards/atlas/pipeline/card.png',
    });
  });
});

describe('claimGenerating', () => {
  it('grants the claim on a repo nobody holds', async () => {
    await expect(store(fakeStorage()).claimGenerating('atlas', 'pipeline')).resolves.toBe(true);
  });

  it('refuses a repo already claimed — two cold requests cannot both spend a Cortex call', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    await expect(cards.claimGenerating('atlas', 'pipeline')).resolves.toBe(true);
    await expect(cards.claimGenerating('atlas', 'pipeline')).resolves.toBe(false);
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const cards = store(fakeStorage());

    const [a, b] = await Promise.all([
      cards.claimGenerating('atlas', 'pipeline'),
      cards.claimGenerating('atlas', 'pipeline'),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('can be released, so a run that died is retryable', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    await cards.claimGenerating('atlas', 'pipeline');
    await cards.clearState('atlas', 'pipeline');

    await expect(cards.claimGenerating('atlas', 'pipeline')).resolves.toBe(true);
  });

  it('replaces only the exact failed marker the caller observed', async () => {
    const fake = fakeStorage();
    const cards = store(fake);
    await cards.markFailed('atlas', 'pipeline', 'pipeline_error');
    const failed = await cards.readState('atlas', 'pipeline');

    await expect(cards.claimGenerating('atlas', 'pipeline', failed)).resolves.toBe(true);
    await expect(cards.claimGenerating('atlas', 'pipeline', failed)).resolves.toBe(false);
  });

  it('preserves an opaque generation above the JavaScript safe integer range', async () => {
    const fake = fakeStorage();
    const failed = {
      status: 'failed' as const,
      repo: 'atlas/pipeline',
      errorCode: 'pipeline_error',
      failedAt: new Date().toISOString(),
    };
    fake.objects.set('cards/atlas/pipeline/state.json', {
      data: JSON.stringify(failed),
      generation: '9007199254740993',
      custom: {},
    });

    await expect(store(fake).claimGenerating('atlas', 'pipeline', failed)).resolves.toBe(true);
  });

  it('refuses replacement when the marker changes after its generation is read', async () => {
    const fake = fakeStorage();
    const failed = {
      status: 'failed' as const,
      repo: 'atlas/pipeline',
      errorCode: 'pipeline_error',
      failedAt: new Date().toISOString(),
    };
    fake.objects.set('cards/atlas/pipeline/state.json', {
      data: JSON.stringify(failed),
      generation: 1,
      custom: {},
    });
    const originalBucket = fake.storage.bucket();
    let replaced = false;
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => {
        const file = originalBucket.file(path, options);
        return {
          ...file,
          getMetadata: async () => {
            const metadata = await file.getMetadata();
            if (!replaced && path.endsWith('/state.json')) {
              replaced = true;
              await originalBucket.file(path).save(
                JSON.stringify({
                  status: 'generating',
                  repo: 'atlas/pipeline',
                  startedAt: new Date().toISOString(),
                }),
              );
            }
            return metadata;
          },
        };
      },
    });
    const cards = store(fake);

    await expect(cards.claimGenerating('atlas', 'pipeline', failed)).resolves.toBe(false);
  });
});

describe('claimDailyQuota', () => {
  const TODAY = '2026-07-11';

  it('grants a slot when the budget is untouched', async () => {
    await expect(store(fakeStorage()).claimDailyQuota(3, TODAY)).resolves.toBe(true);
  });

  it('counts up to the cap and then refuses', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    await expect(cards.claimDailyQuota(2, TODAY)).resolves.toBe(true);
    await expect(cards.claimDailyQuota(2, TODAY)).resolves.toBe(true);
    await expect(cards.claimDailyQuota(2, TODAY)).resolves.toBe(false);
  });

  it('keeps a separate budget per day', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    await cards.claimDailyQuota(1, TODAY);
    await expect(cards.claimDailyQuota(1, TODAY)).resolves.toBe(false);
    await expect(cards.claimDailyQuota(1, '2026-07-12')).resolves.toBe(true);
  });

  it('refuses rather than double-counting when two instances race', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    // Both read count=0, both try to write generation 0; one must lose and retry.
    const [first, second] = await Promise.all([
      cards.claimDailyQuota(1, TODAY),
      cards.claimDailyQuota(1, TODAY),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('gives up rather than hammering a saturated counter', async () => {
    const objects = new Map<string, FakeObject>();
    const fake = fakeStorage(objects);
    // Every write loses its precondition: the object always moves first.
    const bucket = fake.storage.bucket();
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string) => ({
        ...bucket.file(path),
        save: () => Promise.reject(new GcsError(412)),
      }),
    });

    await expect(store(fake).claimDailyQuota(100, TODAY)).resolves.toBe(false);
  });

  it('returns a reserved slot when queue admission fails', async () => {
    const fake = fakeStorage();
    const cards = store(fake);

    await cards.claimDailyQuota(1, TODAY);
    await cards.releaseDailyQuota(TODAY);

    await expect(cards.claimDailyQuota(1, TODAY)).resolves.toBe(true);
  });

  it('does nothing when there is no quota reservation to return', async () => {
    const cards = store(fakeStorage());

    await expect(cards.releaseDailyQuota(TODAY)).resolves.toBeUndefined();
  });

  it('retries a quota release after a concurrent writer wins', async () => {
    const fake = fakeStorage();
    const cards = store(fake);
    await cards.claimDailyQuota(2, TODAY);
    const bucket = fake.storage.bucket();
    let blocked = false;
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => {
        const file = bucket.file(path, options);
        return {
          ...file,
          save: (data: string | Buffer, saveOptions?: Record<string, unknown>) => {
            if (!blocked && path.includes('/quota/')) {
              blocked = true;
              return Promise.reject(new GcsError(412));
            }
            return file.save(data, saveOptions);
          },
        };
      },
    });

    await cards.releaseDailyQuota(TODAY);

    await expect(cards.claimDailyQuota(1, TODAY)).resolves.toBe(true);
  });

  it('retries a quota release when the observed generation is replaced before download', async () => {
    const fake = fakeStorage();
    fake.objects.set(`meta/quota/${TODAY}.json`, {
      data: JSON.stringify({ count: 1 }),
      generation: 1,
      custom: {},
    });
    const bucket = fake.storage.bucket();
    let replaced = false;
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => {
        const file = bucket.file(path, options);
        return {
          ...file,
          getMetadata: async () => {
            const metadata = await file.getMetadata();
            if (!replaced && path.includes('/quota/')) {
              replaced = true;
              await bucket.file(path).save(JSON.stringify({ count: 2 }));
            }
            return metadata;
          },
        };
      },
    });
    const cards = store(fake);

    await cards.releaseDailyQuota(TODAY);

    expect(JSON.parse(fake.objects.get(`meta/quota/${TODAY}.json`)?.data ?? '{}')).toEqual({
      count: 1,
    });
  });

  it('propagates a quota release storage failure', async () => {
    const fake = fakeStorage();
    fake.objects.set(`meta/quota/${TODAY}.json`, {
      data: JSON.stringify({ count: 1 }),
      generation: 1,
      custom: {},
    });
    const bucket = fake.storage.bucket();
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => ({
        ...bucket.file(path, options),
        save: () => Promise.reject(new GcsError(500)),
      }),
    });
    const cards = store(fake);

    await expect(cards.releaseDailyQuota(TODAY)).rejects.toThrow('gcs 500');
  });

  it('fails loudly after five quota release contention losses', async () => {
    const fake = fakeStorage();
    fake.objects.set(`meta/quota/${TODAY}.json`, {
      data: JSON.stringify({ count: 1 }),
      generation: 1,
      custom: {},
    });
    const bucket = fake.storage.bucket();
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => ({
        ...bucket.file(path, options),
        save: () => Promise.reject(new GcsError(412)),
      }),
    });
    const cards = store(fake);

    await expect(cards.releaseDailyQuota(TODAY)).rejects.toThrow(
      `could not release daily quota for ${TODAY}`,
    );
  });

  it('fails loudly after five unstable snapshot reads', async () => {
    const fake = fakeStorage();
    fake.objects.set(`meta/quota/${TODAY}.json`, {
      data: JSON.stringify({ count: 1 }),
      generation: 1,
      custom: {},
    });
    const bucket = fake.storage.bucket();
    let downloads = 0;
    vi.spyOn(fake.storage, 'bucket').mockReturnValue({
      file: (path: string, options?: { generation?: string }) => ({
        ...bucket.file(path, options),
        download: () => {
          downloads += 1;
          return Promise.reject(new GcsError(404));
        },
      }),
    });

    await expect(store(fake).releaseDailyQuota(TODAY)).rejects.toThrow(
      `could not read a stable snapshot of meta/quota/${TODAY}.json`,
    );
    expect(downloads).toBe(5);
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
});
