import { Storage } from '@google-cloud/storage';
import type { CardPayload } from './card/types.js';

/**
 * The bucket is the cache of record. The card object's existence *is* the ready state —
 * there is no database, and no second source of truth to drift away from it.
 *
 * Cloud Run is the only writer. Clients read the public objects directly.
 */

export type JobState =
  | { status: 'ready'; repo: string; accent: string; generatedAt: string }
  | { status: 'generating'; repo: string; startedAt: string }
  | { status: 'failed'; repo: string; errorCode: string; failedAt: string; reasons?: string[] }
  | { status: 'unknown'; repo: string };

export interface CardStore {
  readState(owner: string, repo: string): Promise<JobState>;
  readCardSvg(owner: string, repo: string): Promise<string | null>;
  markGenerating(owner: string, repo: string): Promise<void>;
  markFailed(owner: string, repo: string, errorCode: string, reasons?: string[]): Promise<void>;
  writeCard(owner: string, repo: string, svg: string, payload: CardPayload): Promise<void>;
  /** Atomically claim one slot from today's generation budget. False when the cap is hit. */
  claimDailyQuota(cap: number, today: string): Promise<boolean>;
}

const prefix = (owner: string, repo: string): string => `cards/${owner}/${repo}`;

interface QuotaFile {
  count: number;
}

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

      // Ready is checked first and checked by existence: a card in the bucket is a card,
      // whatever a stale marker next to it might claim.
      const card = await readJson(`${base}/card.json`);
      if (card) {
        return {
          status: 'ready',
          repo: `${owner}/${repo}`,
          accent: (card.value as CardPayload).accent,
          generatedAt: (card.value as CardPayload).generatedAt,
        };
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

    async markGenerating(owner, repo) {
      const state: JobState = {
        status: 'generating',
        repo: `${owner}/${repo}`,
        startedAt: new Date().toISOString(),
      };
      await bucket.file(`${prefix(owner, repo)}/state.json`).save(JSON.stringify(state), {
        contentType: 'application/json',
        metadata: { cacheControl: 'no-store' },
      });
    },

    async markFailed(owner, repo, errorCode, reasons) {
      // A failed repo is cached exactly so a bad slug cannot be retried into a bill.
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

      // The SVG lands before the payload, and the payload is what `readState` reads as
      // ready — so a crash between the two writes leaves a repo retryable, never a page
      // claiming ready with no card behind it.
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

      // Read-modify-write guarded by the object generation: two instances racing on the
      // same counter cannot both win, so the cap holds across a scaled-out service.
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

      // Five straight losses means the service is saturated, which is what the cap exists
      // to stop. Refusing is the correct answer, not retrying harder.
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
