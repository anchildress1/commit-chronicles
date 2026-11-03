import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD } from '../fixtures/card.js';
import { fakeSnowflake, fakeStore } from './fakes.js';

const adapters = vi.hoisted(() => ({ store: vi.fn(), snowflake: vi.fn() }));
vi.mock('../../src/server/bucket.js', () => ({ createCardStore: adapters.store }));
vi.mock('../../src/server/snowflake.js', () => ({ createSnowflakeClient: adapters.snowflake }));

const originalArgv = process.argv;
let store: ReturnType<typeof fakeStore>;
let snowflake: ReturnType<typeof fakeSnowflake>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = ['node', 'rerender'];
  vi.stubEnv('CARD_BUCKET', 'test-bucket');
  vi.stubEnv('SNOWFLAKE_ACCOUNT', 'test-account');
  vi.stubEnv('SNOWFLAKE_USER', 'test-user');
  vi.stubEnv('SNOWFLAKE_PAT', 'test-token');
  vi.stubEnv('TASKS_QUEUE', '');
  store = fakeStore();
  snowflake = fakeSnowflake(() => CARD, CARD);
  vi.spyOn(snowflake, 'close');
  adapters.store.mockReturnValue(store);
  adapters.snowflake.mockReturnValue(snowflake);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('rerender command', () => {
  it('finishes publishing each requested card before starting the next, including duplicates', async () => {
    process.argv.push('atlas/pipeline', 'atlas/pipeline', 'nyx/render-core');
    let release!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publish = store.writeCard;
    const write = vi.spyOn(store, 'writeCard').mockImplementationOnce(async (...args) => {
      await firstWrite;
      return publish(...args);
    });
    const list = vi.spyOn(snowflake, 'listCards');
    const log = vi.spyOn(console, 'log');

    const run = import('../../src/server/rerender.js');
    await expect.poll(() => write.mock.calls.length).toBe(1);
    expect(snowflake.calls).toEqual(['fetchCard:atlas/pipeline']);
    expect(snowflake.close).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();

    release();
    await run;
    expect(snowflake.calls).toEqual([
      'fetchCard:atlas/pipeline',
      'fetchCard:atlas/pipeline',
      'fetchCard:nyx/render-core',
    ]);
    expect(store.writes).toEqual([
      'card:atlas/pipeline',
      'card:atlas/pipeline',
      'card:nyx/render-core',
    ]);
    expect(store.cards.get('nyx/render-core')?.png.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ severity: 'INFO', message: 'done', redrawn: 3, of: 3 }),
    );
    expect(snowflake.close).toHaveBeenCalledExactlyOnceWith();
  });

  it('reports absent cards without publishing them or inflating the completed count', async () => {
    snowflake.listCards = vi.fn().mockResolvedValue([
      { owner: 'atlas', repo: 'pipeline' },
      { owner: 'missing', repo: 'card' },
    ]);
    const fetch = vi
      .spyOn(snowflake, 'fetchCard')
      .mockResolvedValueOnce(CARD)
      .mockResolvedValueOnce(null);
    const log = vi.spyOn(console, 'log');

    await import('../../src/server/rerender.js');

    expect(fetch.mock.calls).toEqual([
      ['atlas', 'pipeline'],
      ['missing', 'card'],
    ]);
    expect(store.writes).toEqual(['card:atlas/pipeline']);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ severity: 'INFO', message: 'no card to redraw', repo: 'missing/card' }),
    );
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ severity: 'INFO', message: 'done', redrawn: 1, of: 2 }),
    );
    expect(snowflake.close).toHaveBeenCalledExactlyOnceWith();
  });

  it('closes an empty batch without fetching or publishing a card', async () => {
    snowflake.listCards = vi.fn().mockResolvedValue([]);
    const log = vi.spyOn(console, 'log');

    await import('../../src/server/rerender.js');

    expect(snowflake.calls).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(log).toHaveBeenLastCalledWith(
      JSON.stringify({ severity: 'INFO', message: 'done', redrawn: 0, of: 0 }),
    );
    expect(snowflake.close).toHaveBeenCalledExactlyOnceWith();
  });

  it('propagates a failed publish before fetching or publishing any later card', async () => {
    process.argv.push('atlas/pipeline', 'nyx/render-core');
    const failure = new Error('publish failed');
    const write = vi.spyOn(store, 'writeCard').mockRejectedValue(failure);
    const log = vi.spyOn(console, 'log');

    await expect(import('../../src/server/rerender.js')).rejects.toBe(failure);

    expect(snowflake.calls).toEqual(['fetchCard:atlas/pipeline']);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.writes).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('rejects an invalid requested slug before starting any redraw', async () => {
    process.argv.push('atlas/pipeline', '../invalid');

    await expect(import('../../src/server/rerender.js')).rejects.toThrow();

    expect(snowflake.calls).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});
