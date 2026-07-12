import type { CardStore, JobState } from './bucket.js';
import type { SnowflakeClient } from './snowflake.js';
import type { Config } from './config.js';
import type { TaskQueue } from './queue.js';
import { TaskNotCreatedError } from './queue.js';
import type { RepoSlug } from '../shared/slug.js';
import { isRetryable } from '../shared/errors.js';
import { renderCard } from './card/svg.js';
import { isCardPayload } from './card/types.js';

export type StartOutcome =
  | { accepted: true; state: JobState }
  | {
      accepted: false;
      reason: 'already_ready' | 'already_generating' | 'already_failed' | 'quota_exceeded';
      state: JobState;
    };

export interface Generator {
  /**
   * Admit a repo and hand it to the queue. Cheap, and safe to call twice.
   *
   * @returns Whether the job was accepted, and the state the caller should show either way.
   */
  start(slug: RepoSlug): Promise<StartOutcome>;
  /** Run the pipeline. Only the queue worker calls this; it spends the Cortex call. */
  run(slug: RepoSlug): Promise<void>;
  /**
   * Redraw an existing card from the words already written for it.
   *
   * Spends no Cortex call and no quota, so a renderer change can be rolled across every
   * card for free.
   *
   * @returns False when the repo has no card to redraw.
   */
  rerender(slug: RepoSlug): Promise<boolean>;
}

export type Log = (message: string, detail?: Record<string, unknown>) => void;

export interface PipelineDeps {
  store: CardStore;
  snowflake: SnowflakeClient;
  log?: Log;
}

export interface GeneratorDeps extends PipelineDeps {
  config: Config;
  queue: TaskQueue;
  now?: () => Date;
}

/**
 * Read the repo, render its card, and write it to the bucket.
 *
 * Never throws: a failure is recorded as a cached failed state instead. Stands alone
 * because the queue runs it and the generator holds the queue.
 */
export async function runGeneration(
  { store, snowflake, log = () => undefined }: PipelineDeps,
  slug: RepoSlug,
): Promise<void> {
  const { owner, repo } = slug;

  try {
    const result = await snowflake.readRepo(owner, repo);

    if (!isCardPayload(result)) {
      log('generation failed', { repo: slug.slug, errorCode: result.errorCode });
      await store.markFailed(owner, repo, result.errorCode, result.reasons);
      return;
    }

    await store.writeCard(owner, repo, renderCard(result), result);
    log('generation ready', {
      repo: slug.slug,
      storyline: result.storyline,
      accent: result.accent,
      cortexQueryId: result.cortexQueryId,
    });
  } catch (error) {
    log('generation threw', { repo: slug.slug, error: String(error) });
    await store.markFailed(owner, repo, 'pipeline_error');
  }
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The admission rules around the pipeline: cache, in-flight, retryability, and daily cap.
 */
export function createGenerator(deps: GeneratorDeps): Generator {
  const { store, config, queue, now = () => new Date(), log = () => undefined } = deps;

  return {
    async start(slug) {
      const state = await store.readState(slug.owner, slug.repo);

      if (state.status === 'ready') {
        return { accepted: false, reason: 'already_ready', state };
      }

      if (state.status === 'failed' && !isRetryable(state.errorCode)) {
        return { accepted: false, reason: 'already_failed', state };
      }

      if (state.status === 'generating') {
        const age = now().getTime() - new Date(state.startedAt).getTime();
        // Older than the TTL means the run died. Younger means live — and paying twice.
        if (age < config.generatingTtlMs) {
          return { accepted: false, reason: 'already_generating', state };
        }
      }

      // Replacing a retryable/dead marker is conditional on the exact state we read. Two
      // retries cannot delete or overwrite each other's fresh claim.
      const claimed = await store.claimGenerating(
        slug.owner,
        slug.repo,
        state.status === 'unknown' ? undefined : state,
      );
      if (!claimed) {
        return {
          accepted: false,
          reason: 'already_generating',
          state: await store.readState(slug.owner, slug.repo),
        };
      }

      const quotaDate = today(now());
      let hasQuota: boolean;
      try {
        hasQuota = await store.claimDailyQuota(config.dailyGenerationCap, quotaDate);
      } catch (error) {
        await store.clearState(slug.owner, slug.repo);
        throw error;
      }

      if (!hasQuota) {
        await store.clearState(slug.owner, slug.repo);
        log('quota exceeded', { repo: slug.slug });
        return {
          accepted: false,
          reason: 'quota_exceeded',
          state: { status: 'unknown', repo: slug.slug },
        };
      }

      try {
        await queue.enqueue(slug);
      } catch (error) {
        // An ambiguous failure may have created the task after all, so the claim stands and
        // the TTL reaps it. Rolling back here would risk a second, paid, concurrent run.
        if (!(error instanceof TaskNotCreatedError)) throw error;

        // Nothing will ever pick this up, so release the claim instead of stranding the repo
        // on `generating` until the TTL lapses. A rollback that fails is logged and stepped
        // over: what the caller has to be told is that the enqueue failed, not that the
        // apology for it also failed.
        const rollback = await Promise.allSettled([
          store.clearState(slug.owner, slug.repo),
          store.releaseDailyQuota(quotaDate),
        ]);
        for (const outcome of rollback) {
          if (outcome.status === 'rejected') {
            log('rollback failed', { repo: slug.slug, cause: String(outcome.reason) });
          }
        }

        throw error;
      }

      return {
        accepted: true,
        state: { status: 'generating', repo: slug.slug, startedAt: now().toISOString() },
      };
    },

    run: (slug) => runGeneration(deps, slug),

    async rerender(slug) {
      const card = await deps.snowflake.fetchCard(slug.owner, slug.repo);
      if (!card) return false;

      await store.writeCard(slug.owner, slug.repo, renderCard(card), card);
      log('card redrawn', { repo: slug.slug, pipelineVersion: card.pipelineVersion });
      return true;
    },
  };
}
