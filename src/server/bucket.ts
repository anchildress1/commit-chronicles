import { Storage } from '@google-cloud/storage';
import type { CardPayload } from './card/types.js';

// The cache of record. The card's existence *is* the ready state — no second source of
// truth to drift. Cloud Run is the only writer.

export type JobState =
  | { status: 'ready'; repo: string }
  | { status: 'generating'; repo: string; startedAt: string }
  | { status: 'failed'; repo: string; errorCode: string; failedAt: string; reasons?: string[] }
  | { status: 'unknown'; repo: string };

export interface CardStore {
  /** The repo's state, decided by which objects exist. Never throws for a repo not found. */
  readState(owner: string, repo: string): Promise<JobState>;
  /** The rendered card, or null when there is none. */
  readCardSvg(owner: string, repo: string): Promise<string | null>;
  /**
   * Claim the repo for generation.
   *
   * @returns False when another caller already holds the claim — the write is create-only,
   *   so two concurrent requests for one cold repo cannot both start a Cortex call.
   */
  claimGenerating(owner: string, repo: string): Promise<boolean>;
  /** Cache a failure, so a bad slug cannot be retried into a bill. */
  markFailed(owner: string, repo: string, errorCode: string, reasons?: string[]): Promise<void>;
  /** Drop the state marker. Used to release a claim that was never followed through. */
  clearState(owner: string, repo: string): Promise<void>;
  /** Publish the card and clear the generating marker. The SVG lands before the payload. */
  writeCard(owner: string, repo: string, svg: string, payload: CardPayload): Promise<void>;
  /**
   * Atomically claim one slot from today's generation budget.
   *
   * @returns False when the cap is spent, and when the counter is too contended to claim.
   */
  claimDailyQuota(cap: number, today: string): Promise<boolean>;
}

const prefix = (owner: string, repo: string): string => `cards/${owner}/${repo}`;

interface QuotaFile {
  count: number;
}

/**
 * The bucket-backed card store.
 *
 * @param storage Injectable for tests; defaults to application-default credentials.
 */
export function createCardStore(bucketName: string, storage = new Storage()): CardStore {
  const bucket = storage.bucket(bucketName);

  const readJson = async (path: string): Promise<{ value: unknown; generation: string } | null> => {
    const file = bucket.file(path);
    try {
      const [contents] = await file.download();
      const [metadata] = await file.getMetadata();
      return {
        value: JSON.parse(contents.toString('utf8')),
        generation: String(metadata.generation ?? '0'),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  return {
    async readState(owner, repo) {
      const base = prefix(owner, repo);

      // Checked by existence, and checked first: a card outranks any stale marker beside it.
      const [ready] = await bucket.file(`${base}/card.json`).exists();
      if (ready) {
        return { status: 'ready', repo: `${owner}/${repo}` };
      }

      const state = await readJson(`${base}/state.json`);
      return (
        (state?.value as JobState | undefined) ?? { status: 'unknown', repo: `${owner}/${repo}` }
      );
    },

    async readCardSvg(owner, repo) {
      try {
        const [contents] = await bucket.file(`${prefix(owner, repo)}/card.svg`).download();
        return contents.toString('utf8');
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async claimGenerating(owner, repo) {
      const state: JobState = {
        status: 'generating',
        repo: `${owner}/${repo}`,
        startedAt: new Date().toISOString(),
      };

      try {
        // ifGenerationMatch: 0 means "only if this object does not exist". Two requests for
        // the same cold repo race here, and exactly one wins.
        await bucket.file(`${prefix(owner, repo)}/state.json`).save(JSON.stringify(state), {
          contentType: 'application/json',
          metadata: { cacheControl: 'no-store' },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        return true;
      } catch (error) {
        if (isPreconditionFailed(error)) return false;
        throw error;
      }
    },

    async clearState(owner, repo) {
      await bucket
        .file(`${prefix(owner, repo)}/state.json`)
        .delete()
        .catch((error: unknown) => {
          if (!isNotFound(error)) throw error;
        });
    },

    async markFailed(owner, repo, errorCode, reasons) {
      const state: JobState = {
        status: 'failed',
        repo: `${owner}/${repo}`,
        errorCode,
        failedAt: new Date().toISOString(),
        ...(reasons ? { reasons } : {}),
      };
      await bucket.file(`${prefix(owner, repo)}/state.json`).save(JSON.stringify(state), {
        contentType: 'application/json',
        metadata: { cacheControl: 'no-store' },
      });
    },

    async writeCard(owner, repo, svg, payload) {
      const base = prefix(owner, repo);

      // SVG first: `readState` reads the payload as ready, so a crash between the two
      // leaves the repo retryable rather than ready-with-no-card.
      await bucket.file(`${base}/card.svg`).save(svg, {
        contentType: 'image/svg+xml',
        metadata: { cacheControl: 'public, max-age=3600' },
      });

      await bucket.file(`${base}/card.json`).save(JSON.stringify(payload), {
        contentType: 'application/json',
        metadata: { cacheControl: 'public, max-age=300' },
      });

      await bucket
        .file(`${base}/state.json`)
        .delete()
        .catch((error: unknown) => {
          if (!isNotFound(error)) throw error;
        });
    },

    async claimDailyQuota(cap, today) {
      const path = `meta/quota/${today}.json`;
      const file = bucket.file(path);

      // Generation-guarded read-modify-write: two instances racing cannot both win.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readJson(path);
        const count = (current?.value as QuotaFile | undefined)?.count ?? 0;
        if (count >= cap) return false;

        try {
          await file.save(JSON.stringify({ count: count + 1 } satisfies QuotaFile), {
            contentType: 'application/json',
            metadata: { cacheControl: 'no-store' },
            preconditionOpts: { ifGenerationMatch: Number(current?.generation ?? 0) },
          });
          return true;
        } catch (error) {
          if (!isPreconditionFailed(error)) throw error;
        }
      }

      // Five straight losses means saturation, which is what the cap exists to stop.
      return false;
    },
  };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'number' ? code : undefined;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  return statusOf(error) === 412;
}
