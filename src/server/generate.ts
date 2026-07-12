import type { CardStore, JobState } from './bucket.js';
import type { SnowflakeClient } from './snowflake.js';
import type { Config } from './config.js';
import type { TaskQueue } from './queue.js';
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
  /** Admit a repo and hand it to the queue. Cheap, and safe to call twice. */
  start(slug: RepoSlug): Promise<StartOutcome>;
  /** The pipeline itself. Only the queue worker calls this. */
  run(slug: RepoSlug): Promise<void>;
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

/** The pipeline. Standalone: the queue runs it, and the generator holds the queue. */
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

      if (!(await store.claimDailyQuota(config.dailyGenerationCap, today(now())))) {
        log('quota exceeded', { repo: slug.slug });
        return {
          accepted: false,
          reason: 'quota_exceeded',
          state: { status: 'unknown', repo: slug.slug },
        };
      }

      // Marker before task: a failed enqueue strands the repo only until the TTL lapses,
      // where the reverse order would run a job nothing had claimed.
      await store.markGenerating(slug.owner, slug.repo);
      await queue.enqueue(slug);

      return {
        accepted: true,
        state: { status: 'generating', repo: slug.slug, startedAt: now().toISOString() },
      };
    },

    run: (slug) => runGeneration(deps, slug),
  };
}
