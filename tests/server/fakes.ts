import type { CardStore, JobState } from '../../src/server/bucket.js';
import type { SnowflakeClient } from '../../src/server/snowflake.js';
import type { TaskAuthenticator, TaskQueue } from '../../src/server/queue.js';
import type { CardPayload, ReadRepoResult } from '../../src/server/card/types.js';
import type { RepoSlug } from '../../src/shared/slug.js';

/** An in-memory stand-in for the bucket, with the same semantics the real store has. */
export interface FakeStore extends CardStore {
  cards: Map<string, { svg: string; payload: CardPayload }>;
  states: Map<string, JobState>;
  quotaUsed: number;
  writes: string[];
}

export function fakeStore(): FakeStore {
  const cards = new Map<string, { svg: string; payload: CardPayload }>();
  const states = new Map<string, JobState>();
  const writes: string[] = [];
  const key = (owner: string, repo: string): string => `${owner}/${repo}`;

  const store: FakeStore = {
    cards,
    states,
    quotaUsed: 0,
    writes,

    readState: (owner, repo) => {
      if (cards.has(key(owner, repo))) {
        return Promise.resolve({ status: 'ready', repo: key(owner, repo) });
      }
      return Promise.resolve(
        states.get(key(owner, repo)) ?? { status: 'unknown', repo: key(owner, repo) },
      );
    },

    readCardSvg: (owner, repo) => Promise.resolve(cards.get(key(owner, repo))?.svg ?? null),

    markGenerating: (owner, repo) => {
      writes.push(`generating:${key(owner, repo)}`);
      states.set(key(owner, repo), {
        status: 'generating',
        repo: key(owner, repo),
        startedAt: new Date().toISOString(),
      });
      return Promise.resolve();
    },

    markFailed: (owner, repo, errorCode, reasons) => {
      writes.push(`failed:${key(owner, repo)}:${errorCode}`);
      states.set(key(owner, repo), {
        status: 'failed',
        repo: key(owner, repo),
        errorCode,
        failedAt: new Date().toISOString(),
        ...(reasons ? { reasons } : {}),
      });
      return Promise.resolve();
    },

    writeCard: (owner, repo, svg, payload) => {
      writes.push(`card:${key(owner, repo)}`);
      cards.set(key(owner, repo), { svg, payload });
      states.delete(key(owner, repo));
      return Promise.resolve();
    },

    claimDailyQuota: (cap) => {
      if (store.quotaUsed >= cap) return Promise.resolve(false);
      store.quotaUsed += 1;
      return Promise.resolve(true);
    },
  };

  return store;
}

export interface FakeSnowflake extends SnowflakeClient {
  calls: string[];
}

export function fakeSnowflake(
  respond: (owner: string, repo: string) => Promise<ReadRepoResult> | ReadRepoResult,
  stored: CardPayload | null = null,
): FakeSnowflake {
  const calls: string[] = [];
  return {
    calls,
    readRepo: async (owner, repo) => {
      calls.push(`${owner}/${repo}`);
      return await respond(owner, repo);
    },
    fetchCard: (owner, repo) => {
      calls.push(`fetchCard:${owner}/${repo}`);
      return Promise.resolve(stored);
    },
    listCards: () => Promise.resolve(stored ? [{ owner: 'atlas', repo: 'pipeline' }] : []),
    close: () => Promise.resolve(),
  };
}

export interface FakeQueue extends TaskQueue {
  enqueued: RepoSlug[];
  /** Deliver every queued task, the way Cloud Tasks eventually would. */
  deliver(): Promise<void>;
}

export function fakeQueue(run: (slug: RepoSlug) => Promise<void>): FakeQueue {
  const enqueued: RepoSlug[] = [];

  return {
    enqueued,
    enqueue: (slug) => {
      enqueued.push(slug);
      return Promise.resolve();
    },
    deliver: async () => {
      const pending = enqueued.splice(0, enqueued.length);
      for (const slug of pending) {
        await run(slug);
      }
    },
  };
}

export function fakeTaskAuth(accept: boolean): TaskAuthenticator {
  return { verify: (header) => Promise.resolve(accept && header === 'Bearer good-token') };
}
