import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { createGenerator, runGeneration, type Generator } from '../../src/server/generate.js';
import type { Config } from '../../src/server/config.js';
import { CARD } from '../fixtures/card.js';
import {
  fakeQueue,
  fakeSnowflake,
  fakeStore,
  fakeTaskAuth,
  type FakeQueue,
  type FakeStore,
} from './fakes.js';

const CONFIG: Config = {
  port: 8080,
  bucket: 'test-bucket',
  publicOrigin: 'https://commitchronicles.dev',
  dailyGenerationCap: 5,
  generatingTtlMs: 600_000,
  tasks: null,
  snowflake: {
    account: 'a',
    username: 'u',
    token: 't',
    warehouse: 'w',
    database: 'd',
    schema: 's',
    role: 'r',
  },
};

interface Harness {
  app: ReturnType<typeof createApp>;
  store: FakeStore;
  queue: FakeQueue;
  generator: Generator;
}

function harness(cap = 5, authOk = true): Harness {
  const store = fakeStore();
  const snowflake = fakeSnowflake(() => CARD);
  const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
  const generator = createGenerator({
    store,
    snowflake,
    config: { ...CONFIG, dailyGenerationCap: cap },
    queue,
  });

  const app = createApp({ store, generator, taskAuth: fakeTaskAuth(authOk) });
  return { app, store, queue, generator };
}

const post = async (
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const generate = async (app: ReturnType<typeof createApp>, repo: unknown): Promise<Response> =>
  await post(app, '/api/generate', { repo });

describe('GET /healthz', () => {
  it('answers', async () => {
    const { app } = harness();
    expect((await app.request('/healthz')).status).toBe(200);
  });
});

describe('POST /api/generate', () => {
  it('accepts a cold repo with 202 and queues it', async () => {
    const { app, queue } = harness();

    const response = await generate(app, 'atlas/pipeline');

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'generating', repo: 'atlas/pipeline' });
    expect(queue.enqueued).toHaveLength(1);
  });

  it('attaches to an existing card with 200 instead of erroring', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await generate(app, 'atlas/pipeline');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready', accent: '#e8a04a' });
  });

  it('normalizes a full GitHub URL', async () => {
    const { app } = harness();

    const response = await generate(app, 'https://github.com/Atlas/Pipeline');

    expect(await response.json()).toMatchObject({ repo: 'atlas/pipeline' });
  });

  it.each([
    ['../../etc/passwd', 'traversal'],
    ['no-slash', 'not a slug'],
    ['', 'empty'],
    [undefined, 'missing'],
    [42, 'not a string'],
  ])('rejects %j (%s) with 400', async (repo, _why) => {
    const { app, queue } = harness();

    const response = await generate(app, repo);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_repo' });
    expect(queue.enqueued).toHaveLength(0);
  });

  it('rejects a body that is not JSON', async () => {
    const { app } = harness();

    const response = await app.request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
  });

  it('returns 429 when the daily cap is spent', async () => {
    const { app, queue } = harness(1);
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await generate(app, 'nyx/render-core');

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: 'quota_exceeded' });
  });
});

describe('POST /internal/generate', () => {
  const AUTH = { authorization: 'Bearer good-token' };

  it('runs the pipeline for a task from the queue', async () => {
    const { app, store } = harness();

    const response = await post(app, '/internal/generate', { repo: 'atlas/pipeline' }, AUTH);

    expect(response.status).toBe(200);
    expect(store.cards.has('atlas/pipeline')).toBe(true);
  });

  it('refuses an unsigned request — this route spends Cortex credits', async () => {
    const { app, store } = harness();

    const response = await post(app, '/internal/generate', { repo: 'atlas/pipeline' });

    expect(response.status).toBe(403);
    expect(store.cards.size).toBe(0);
  });

  it('refuses a request whose token does not verify', async () => {
    const { app, store } = harness(5, false);

    const response = await post(
      app,
      '/internal/generate',
      { repo: 'atlas/pipeline' },
      { authorization: 'Bearer forged' },
    );

    expect(response.status).toBe(403);
    expect(store.cards.size).toBe(0);
  });

  it('retires a malformed task instead of letting the queue retry it forever', async () => {
    const { app, store } = harness();

    const response = await post(app, '/internal/generate', { repo: '../../etc/passwd' }, AUTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ error: 'invalid_repo' });
    expect(store.cards.size).toBe(0);
  });
});

describe('GET /api/state/:owner/:repo', () => {
  it('reports unknown for a repo nobody has read', async () => {
    const { app } = harness();

    const response = await app.request('/api/state/atlas/pipeline');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unknown', repo: 'atlas/pipeline' });
  });

  it('reports ready with the accent once the card exists', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await app.request('/api/state/atlas/pipeline');

    expect(await response.json()).toMatchObject({ status: 'ready', accent: '#e8a04a' });
  });

  it('is never cached — a polling client must see the transition', async () => {
    const { app } = harness();
    const response = await app.request('/api/state/atlas/pipeline');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a bad slug with 400', async () => {
    const { app } = harness();
    expect((await app.request('/api/state/-bad/repo')).status).toBe(400);
  });
});

describe('GET /:owner/:repo/card.svg', () => {
  it('serves the card from the bucket', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await app.request('/atlas/pipeline/card.svg');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    expect(await response.text()).toContain('<svg');
  });

  it('sets cache headers camo will honour', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await app.request('/atlas/pipeline/card.svg');

    expect(response.headers.get('cache-control')).toContain('max-age=3600');
  });

  it('404s for a repo with no card, rather than generating one on a GET', async () => {
    const { app, store } = harness();

    const response = await app.request('/atlas/pipeline/card.svg');

    expect(response.status).toBe(404);
    expect(store.quotaUsed).toBe(0);
  });

  it('404s a traversal attempt without touching the bucket', async () => {
    const { app } = harness();
    expect((await app.request('/-bad/repo/card.svg')).status).toBe(404);
  });
});
