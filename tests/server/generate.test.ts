import { describe, expect, it } from 'vitest';
import { createGenerator, runGeneration, type Generator } from '../../src/server/generate.js';
import { TaskNotCreatedError } from '../../src/server/queue.js';
import type { Config } from '../../src/server/config.js';
import { parseSlug } from '../../src/shared/slug.js';
import { CARD } from '../fixtures/card.js';
import {
  fakeQueue,
  fakeSnowflake,
  fakeStore,
  type FakeQueue,
  type FakeSnowflake,
  type FakeStore,
} from './fakes.js';

const SLUG = parseSlug('atlas/pipeline');

function config(overrides: Partial<Config> = {}): Config {
  return {
    port: 8080,
    bucket: 'test-bucket',
    publicOrigin: 'https://commitchronicles.dev',
    dailyGenerationCap: 2,
    generatingTtlMs: 600_000,
    tasks: null,
    snowflake: {
      account: 'acct',
      username: 'user',
      token: 'pat',
      warehouse: 'WH',
      database: 'DB',
      schema: 'RAW',
      role: 'ROLE',
    },
    ...overrides,
  };
}

interface Harness {
  generator: Generator;
  store: FakeStore;
  snowflake: FakeSnowflake;
  queue: FakeQueue;
}

function harness(
  respond: Parameters<typeof fakeSnowflake>[0],
  overrides: Partial<Config> = {},
): Harness {
  const store = fakeStore();
  const snowflake = fakeSnowflake(respond);
  const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
  const generator = createGenerator({ store, snowflake, config: config(overrides), queue });

  return { generator, store, snowflake, queue };
}

describe('start', () => {
  it('admits a cold repo and hands it to the queue without doing the work inline', async () => {
    const { generator, queue, snowflake } = harness(() => CARD);

    const outcome = await generator.start(SLUG);

    expect(outcome).toMatchObject({ accepted: true, state: { status: 'generating' } });
    expect(queue.enqueued.map((slug) => slug.slug)).toEqual(['atlas/pipeline']);
    // The request path must not call Snowflake — that is the worker's job.
    expect(snowflake.calls).toHaveLength(0);
  });

  it('serves a ready repo without queueing anything', async () => {
    const { generator, queue, snowflake } = harness(() => CARD);
    await generator.start(SLUG);
    await queue.deliver();

    const outcome = await generator.start(SLUG);

    expect(outcome).toMatchObject({ accepted: false, reason: 'already_ready' });
    expect(queue.enqueued).toHaveLength(0);
    expect(snowflake.calls).toHaveLength(1);
  });

  it('refuses a second run while one is already in flight', async () => {
    const { generator, queue } = harness(() => CARD);

    await generator.start(SLUG);
    const second = await generator.start(SLUG);

    expect(second).toMatchObject({ accepted: false, reason: 'already_generating' });
    expect(queue.enqueued).toHaveLength(1);
  });

  it('retries a generating marker left behind by a run that died', async () => {
    const { generator, store, queue } = harness(() => CARD);
    store.states.set('atlas/pipeline', {
      status: 'generating',
      repo: 'atlas/pipeline',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    const outcome = await generator.start(SLUG);

    expect(outcome.accepted).toBe(true);
    expect(queue.enqueued).toHaveLength(1);
  });

  it.each(['repo_not_found', 'repo_private', 'repo_empty', 'invalid_repo_slug', 'no_commits'])(
    'never re-runs a %s failure — the answer cannot change',
    async (errorCode) => {
      const { generator, store, queue, snowflake } = harness(() => CARD);
      store.states.set('atlas/pipeline', {
        status: 'failed',
        repo: 'atlas/pipeline',
        errorCode,
        failedAt: new Date().toISOString(),
      });

      const outcome = await generator.start(SLUG);

      expect(outcome).toMatchObject({ accepted: false, reason: 'already_failed' });
      expect(queue.enqueued).toHaveLength(0);
      expect(snowflake.calls).toHaveLength(0);
      expect(store.quotaUsed).toBe(0);
    },
  );

  it.each(['cortex_rejected', 'cortex_empty', 'pipeline_error'])(
    're-runs a %s failure — that one is ours, and the next draft can pass',
    async (errorCode) => {
      const { generator, store, queue } = harness(() => CARD);
      store.states.set('atlas/pipeline', {
        status: 'failed',
        repo: 'atlas/pipeline',
        errorCode,
        failedAt: new Date().toISOString(),
      });

      const outcome = await generator.start(SLUG);

      expect(outcome.accepted).toBe(true);
      expect(queue.enqueued).toHaveLength(1);

      await queue.deliver();
      expect(store.cards.has('atlas/pipeline')).toBe(true);
    },
  );

  it('a retry still costs a slot from the daily cap', async () => {
    const { generator, store } = harness(() => CARD, { dailyGenerationCap: 1 });
    store.states.set('atlas/pipeline', {
      status: 'failed',
      repo: 'atlas/pipeline',
      errorCode: 'cortex_rejected',
      failedAt: new Date().toISOString(),
    });

    await generator.start(SLUG);
    const second = await generator.start(parseSlug('nyx/render-core'));

    expect(store.quotaUsed).toBe(1);
    expect(second).toMatchObject({ accepted: false, reason: 'quota_exceeded' });
  });

  it('refuses a repo whose failure is already cached', async () => {
    const { generator, store, queue, snowflake } = harness(() => ({
      status: 'failed' as const,
      repo: 'atlas/pipeline',
      errorCode: 'repo_not_found',
    }));

    await generator.start(SLUG);
    await queue.deliver();
    expect(store.states.get('atlas/pipeline')).toMatchObject({ errorCode: 'repo_not_found' });

    const second = await generator.start(SLUG);

    expect(second).toMatchObject({ accepted: false, reason: 'already_failed' });
    expect(snowflake.calls).toHaveLength(1);
  });

  it('stops admitting repos once the daily cap is spent', async () => {
    const { generator, queue } = harness(() => CARD, { dailyGenerationCap: 1 });

    await generator.start(SLUG);
    await queue.deliver();

    const other = await generator.start(parseSlug('nyx/render-core'));

    expect(other).toMatchObject({ accepted: false, reason: 'quota_exceeded' });
    expect(queue.enqueued).toHaveLength(0);
  });

  it('does not spend quota on a repo it refuses', async () => {
    const { generator, store, queue } = harness(() => CARD);
    await generator.start(SLUG);
    await queue.deliver();

    await generator.start(SLUG);

    expect(store.quotaUsed).toBe(1);
  });

  it('lets one of two concurrent requests for a cold repo through, not both', async () => {
    // readState cannot separate them: both see `unknown`. The claim is what decides, and a
    // second Cortex call for one repo is money.
    const { generator, store, queue, snowflake } = harness(() => CARD);

    const [a, b] = await Promise.all([generator.start(SLUG), generator.start(SLUG)]);

    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1);
    expect(queue.enqueued).toHaveLength(1);
    expect(store.quotaUsed).toBe(1);

    await queue.deliver();
    expect(snowflake.calls).toEqual(['atlas/pipeline']);
  });

  it('reports the enqueue failure even when the rollback itself fails', async () => {
    // The rollback is an apology for the enqueue. If the apology throws, the caller must still
    // be told what actually went wrong, or the 500 blames the wrong thing entirely.
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    queue.enqueue = () => Promise.reject(new TaskNotCreatedError(new Error('queue is down')));
    store.releaseDailyQuota = () => Promise.reject(new Error('bucket is on fire'));

    const generator = createGenerator({ store, snowflake, config: config(), queue });

    await expect(generator.start(SLUG)).rejects.toThrow('cloud task was not created');
    // The half of the rollback that could run, ran.
    expect(store.states.get('atlas/pipeline')).toBeUndefined();
  });

  it('releases the claim when the queue refuses the task', async () => {
    // Nothing will pick it up, so leaving the marker would strand the repo until the TTL.
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    queue.enqueue = () => Promise.reject(new TaskNotCreatedError(new Error('queue is down')));

    const generator = createGenerator({ store, snowflake, config: config(), queue });

    await expect(generator.start(SLUG)).rejects.toThrow('cloud task was not created');
    expect(store.states.get('atlas/pipeline')).toBeUndefined();
    expect(store.quotaUsed).toBe(0);

    // And the repo can still be read once the queue is back.
    const recovered = createGenerator({
      store,
      snowflake,
      config: config(),
      queue: fakeQueue((slug) => runGeneration({ store, snowflake }, slug)),
    });
    await expect(recovered.start(SLUG)).resolves.toMatchObject({ accepted: true });
    expect(store.quotaUsed).toBe(1);
  });

  it('releases the claim when quota storage fails', async () => {
    const store = fakeStore();
    store.claimDailyQuota = () => Promise.reject(new Error('quota store is down'));
    const snowflake = fakeSnowflake(() => CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    const generator = createGenerator({ store, snowflake, config: config(), queue });

    await expect(generator.start(SLUG)).rejects.toThrow('quota store is down');
    expect(store.states.get('atlas/pipeline')).toBeUndefined();
    expect(queue.enqueued).toHaveLength(0);
  });

  it('retains the claim and quota when queue admission is ambiguous', async () => {
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    queue.enqueue = () => Promise.reject(new Error('deadline exceeded'));
    const generator = createGenerator({ store, snowflake, config: config(), queue });

    await expect(generator.start(SLUG)).rejects.toThrow('deadline exceeded');
    expect(store.states.get('atlas/pipeline')).toMatchObject({ status: 'generating' });
    expect(store.quotaUsed).toBe(1);
  });

  it('lets one of two concurrent retries replace a failed marker', async () => {
    const { generator, store, queue } = harness(() => CARD);
    store.states.set('atlas/pipeline', {
      status: 'failed',
      repo: 'atlas/pipeline',
      errorCode: 'pipeline_error',
      failedAt: new Date().toISOString(),
    });

    const [a, b] = await Promise.all([generator.start(SLUG), generator.start(SLUG)]);

    expect([a.accepted, b.accepted].filter(Boolean)).toHaveLength(1);
    expect(queue.enqueued).toHaveLength(1);
    expect(store.quotaUsed).toBe(1);
  });

  it('marks the repo generating before the task is enqueued', async () => {
    const { generator, store } = harness(() => CARD);

    await generator.start(SLUG);

    expect(store.writes).toEqual(['generating:atlas/pipeline']);
  });
});

describe('rerender', () => {
  function withStoredCard(): { generator: Generator; store: FakeStore; snowflake: FakeSnowflake } {
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD, CARD);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    const generator = createGenerator({ store, snowflake, config: config(), queue });
    return { generator, store, snowflake };
  }

  it('redraws the card from the words already written for it', async () => {
    const { generator, store } = withStoredCard();

    await expect(generator.rerender(SLUG)).resolves.toBe(true);

    expect(store.cards.get('atlas/pipeline')?.svg).toContain('<svg');
    expect(store.cards.get('atlas/pipeline')?.payload.accent).toBe('#e8a04a');
  });

  it('spends no Cortex call and no quota — the words are already paid for', async () => {
    const { generator, store, snowflake } = withStoredCard();

    await generator.rerender(SLUG);

    expect(snowflake.calls).toEqual(['fetchCard:atlas/pipeline']);
    expect(store.quotaUsed).toBe(0);
  });

  it('reports a repo that has no card to redraw', async () => {
    const store = fakeStore();
    const snowflake = fakeSnowflake(() => CARD, null);
    const queue = fakeQueue((slug) => runGeneration({ store, snowflake }, slug));
    const generator = createGenerator({ store, snowflake, config: config(), queue });

    await expect(generator.rerender(SLUG)).resolves.toBe(false);
    expect(store.cards.size).toBe(0);
  });
});

describe('run', () => {
  it('renders the card Snowflake returned and writes it to the bucket', async () => {
    const { generator, store, snowflake } = harness(() => CARD);

    await generator.run(SLUG);

    expect(snowflake.calls).toEqual(['atlas/pipeline']);
    const written = store.cards.get('atlas/pipeline');
    expect(written?.svg).toContain('<svg');
    // The colour on the card is the colour Cortex chose, carried through untouched.
    expect(written?.svg).toContain('#e8a04a');
    expect(written?.payload.accent).toBe('#e8a04a');
  });

  it('caches a failure so a bad repo cannot be retried into a bill', async () => {
    const { generator, store } = harness(() => ({
      status: 'failed' as const,
      repo: 'atlas/pipeline',
      errorCode: 'repo_not_found',
    }));

    await generator.run(SLUG);

    expect(store.states.get('atlas/pipeline')).toMatchObject({
      status: 'failed',
      errorCode: 'repo_not_found',
    });
    expect(store.cards.has('atlas/pipeline')).toBe(false);
  });

  it('records a failure rather than crashing when the warehouse throws', async () => {
    const { generator, store } = harness(() => {
      throw new Error('snowflake exploded');
    });

    await expect(generator.run(SLUG)).resolves.toBeUndefined();

    expect(store.states.get('atlas/pipeline')).toMatchObject({
      status: 'failed',
      errorCode: 'pipeline_error',
    });
  });

  it('clears the generating marker once the card lands', async () => {
    const { generator, store, queue } = harness(() => CARD);

    await generator.start(SLUG);
    await queue.deliver();

    expect(store.states.get('atlas/pipeline')).toBeUndefined();
    expect(store.writes).toEqual(['generating:atlas/pipeline', 'card:atlas/pipeline']);
  });
});
