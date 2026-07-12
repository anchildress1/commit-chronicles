import { Storage } from '@google-cloud/storage';
import { safeAccent } from './card/format.js';
import type { CardPayload } from './card/types.js';

// The cache of record. The card's existence *is* the ready state — no second source of
// truth to drift. Cloud Run is the only writer.

export type JobState =
  /**
   * The accent rides in the object's metadata, so the page can wear the card's colour without
   * downloading the payload on every poll. `cardUrl` points at the public bucket, which is
   * what every reader — the page, a README, camo — fetches the image from.
   */
  | { status: 'ready'; repo: string; accent: string; cardUrl: string }
  | { status: 'generating'; repo: string; startedAt: string }
  | { status: 'failed'; repo: string; errorCode: string; failedAt: string; reasons?: string[] }
  | { status: 'unknown'; repo: string };

export interface CardStore {
  /** The repo's state, decided by which objects exist. Never throws for a repo not found. */
  readState(owner: string, repo: string): Promise<JobState>;
  /**
   * Claim the repo for generation.
   *
   * @returns False when another caller already holds the claim — the write is create-only,
   *   so two concurrent requests for one cold repo cannot both start a Cortex call.
   */
  claimGenerating(owner: string, repo: string, expected?: JobState): Promise<boolean>;
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
  /** Return a reserved slot when queue admission fails before generation starts. */
  releaseDailyQuota(today: string): Promise<void>;
}

const prefix = (owner: string, repo: string): string => `cards/${owner}/${repo}`;

/**
 * Where the world fetches the card from.
 *
 * The bucket is public, so a reader gets the SVG straight from it. Serving the image through
 * Cloud Run instead would put a billed request in front of every README view of every card,
 * to hand back bytes the bucket was already willing to hand back for free.
 */
const publicCardUrl = (bucketName: string, owner: string, repo: string): string =>
  `https://storage.googleapis.com/${bucketName}/${prefix(owner, repo)}/card.svg`;

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
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let generation: string;
      try {
        const [metadata] = await file.getMetadata();
        generation = String(metadata.generation ?? '0');
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }

      try {
        // Bind the body to the generation we just observed. Without this, an overwrite between
        // metadata and download can pair one writer's body with another writer's generation.
        const [contents] = await bucket.file(path, { generation }).download();
        return { value: JSON.parse(contents.toString('utf8')), generation };
      } catch (error) {
        // Metadata existed, so a missing exact generation means another writer replaced it.
        if (!isNotFound(error)) throw error;
      }
    }

    throw new Error(`could not read a stable snapshot of ${path}`);
  };

  return {
    async readState(owner, repo) {
      const base = prefix(owner, repo);

      // Checked first, and checked by metadata: a card outranks any stale marker beside it,
      // and the accent it was drawn in comes back on the same call that proves it exists.
      try {
        const [metadata] = await bucket.file(`${base}/card.json`).getMetadata();
        return {
          status: 'ready',
          repo: `${owner}/${repo}`,
          accent: safeAccent(String(metadata.metadata?.['accent'] ?? '')),
          cardUrl: publicCardUrl(bucketName, owner, repo),
        };
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }

      const state = await readJson(`${base}/state.json`);
      return (
        (state?.value as JobState | undefined) ?? { status: 'unknown', repo: `${owner}/${repo}` }
      );
    },

    async claimGenerating(owner, repo, expected) {
      const path = `${prefix(owner, repo)}/state.json`;
      const current = expected ? await readJson(path) : null;
      if (expected && JSON.stringify(current?.value) !== JSON.stringify(expected)) return false;

      const state: JobState = {
        status: 'generating',
        repo: `${owner}/${repo}`,
        startedAt: new Date().toISOString(),
      };

      try {
        // ifGenerationMatch: 0 means "only if this object does not exist". Two requests for
        // the same cold repo race here, and exactly one wins.
        await bucket.file(path).save(JSON.stringify(state), {
          contentType: 'application/json',
          metadata: { cacheControl: 'no-store' },
          preconditionOpts: {
            ifGenerationMatch: expected ? (current?.generation ?? '0') : 0,
          },
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
        metadata: {
          cacheControl: 'public, max-age=300',
          // Read back by readState. The page wears the colour Cortex chose for this repo,
          // and a poll should not pay for the whole payload to learn one hex.
          metadata: { accent: safeAccent(payload.accent) },
        },
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
            preconditionOpts: { ifGenerationMatch: current?.generation ?? '0' },
          });
          return true;
        } catch (error) {
          if (!isPreconditionFailed(error)) throw error;
        }
      }

      // Five straight losses means saturation, which is what the cap exists to stop.
      return false;
    },

    async releaseDailyQuota(today) {
      const path = `meta/quota/${today}.json`;
      const file = bucket.file(path);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readJson(path);
        const count = (current?.value as QuotaFile | undefined)?.count ?? 0;
        if (count === 0) return;

        try {
          await file.save(JSON.stringify({ count: count - 1 } satisfies QuotaFile), {
            contentType: 'application/json',
            metadata: { cacheControl: 'no-store' },
            preconditionOpts: { ifGenerationMatch: current?.generation ?? '0' },
          });
          return;
        } catch (error) {
          if (!isPreconditionFailed(error)) throw error;
        }
      }

      throw new Error(`could not release daily quota for ${today}`);
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
