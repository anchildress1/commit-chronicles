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
    expect(await response.json()).toMatchObject({ status: 'ready', repo: 'atlas/pipeline' });
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

describe('POST /internal/rerender', () => {
  const AUTH = { authorization: 'Bearer good-token' };

  it('redraws a stored card without a model call', async () => {
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD, CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    const generator = createGenerator({ store, snowflake, config: CONFIG, queue });
    const app = createApp({ store, generator, taskAuth: fakeTaskAuth(true) });

    const response = await post(app, '/internal/rerender', { repo: 'atlas/pipeline' }, AUTH);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'redrawn' });
    expect(store.quotaUsed).toBe(0);
    expect(snowflake.calls).toEqual(['fetchCard:atlas/pipeline']);
  });

  it('refuses an unsigned request', async () => {
    const { app } = harness();
    expect((await post(app, '/internal/rerender', { repo: 'atlas/pipeline' })).status).toBe(403);
  });

  it('404s a repo that has no card yet', async () => {
    const { app } = harness();
    const response = await post(app, '/internal/rerender', { repo: 'atlas/pipeline' }, AUTH);
    expect(response.status).toBe(404);
  });
});

describe('GET /api/state/:owner/:repo', () => {
  it('reports unknown for a repo nobody has read', async () => {
    const { app } = harness();

    const response = await app.request('/api/state/atlas/pipeline');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unknown', repo: 'atlas/pipeline' });
  });

  it('reports ready once the card exists', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const response = await app.request('/api/state/atlas/pipeline');

    expect(await response.json()).toMatchObject({ status: 'ready', repo: 'atlas/pipeline' });
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

describe('serving the card', () => {
  it('does not serve the card at all — the public bucket does', async () => {
    // Every README view fetches this image. Proxying it through Cloud Run would put a billed
    // request in front of bytes the bucket already serves for free.
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    expect((await app.request('/atlas/pipeline/card.svg')).status).toBe(404);
  });

  it('hands the reader the bucket URL once the card exists', async () => {
    const { app, queue } = harness();
    await generate(app, 'atlas/pipeline');
    await queue.deliver();

    const state = (await (await app.request('/api/state/atlas/pipeline')).json()) as {
      cardUrl?: string;
    };

    expect(state.cardUrl).toMatch(
      /^https:\/\/storage\.googleapis\.com\/.+\/cards\/atlas\/pipeline\/card\.svg$/,
    );
  });

  it('offers no card URL for a repo that has none', async () => {
    const { app, store } = harness();

    const state = (await (await app.request('/api/state/atlas/pipeline')).json()) as {
      cardUrl?: string;
    };

    expect(state.cardUrl).toBeUndefined();
    expect(store.quotaUsed).toBe(0);
  });
});
