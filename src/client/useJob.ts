import { useEffect, useState } from 'react';
import type { RepoSlug } from '../shared/slug.js';
import { QuotaExceededError, fetchState, requestGeneration, type JobState } from './api.js';

const POLL_MS = 2500;
/** A generation that has not landed in five minutes is not going to. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface Job {
  state: JobState | null;
  error: string | null;
}

/** What the hook holds, tagged with the repo it belongs to. */
interface Tracked {
  forSlug: string | null;
  state: JobState | null;
  error: string | null;
}

const EMPTY: Tracked = { forSlug: null, state: null, error: null };

function describe(cause: unknown): string {
  if (cause instanceof QuotaExceededError) {
    return "Today's generation budget is spent. Cards already made still load — try again tomorrow.";
  }
  return 'Snowflake could not be reached. Try again in a moment.';
}

const settled = (state: JobState): boolean => state.status === 'ready' || state.status === 'failed';

/**
 * Attach to the job for `slug`.
 *
 * Read the state first and only ask for a generation when the bucket has nothing — a repo
 * someone else already read costs nothing to show, and returning to the page must never
 * re-run Cortex.
 */
export function useJob(slug: RepoSlug | null): Job {
  const [tracked, setTracked] = useState<Tracked>(EMPTY);

  useEffect(() => {
    if (!slug) return;

    // Read through a call, not a variable: a plain flag gets narrowed by the first check
    // and every later guard then reads as dead code, even though cleanup does flip it.
    const live = { current: true };
    const alive = (): boolean => live.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const publish = (next: Omit<Tracked, 'forSlug'>): void => {
      // Late responses from a repo the user already navigated away from are dropped:
      // the state carries the slug it describes, so it can never paint the wrong card.
      if (alive()) setTracked({ forSlug: slug.slug, ...next });
    };

    const poll = async (): Promise<void> => {
      try {
        const next = await fetchState(slug);
        if (!alive()) return;

        publish({ state: next, error: null });
        if (settled(next)) return;

        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          publish({
            state: next,
            error: 'This one is taking longer than it should. Reload to check on it.',
          });
          return;
        }

        timer = setTimeout(() => void poll(), POLL_MS);
      } catch (cause) {
        publish({ state: null, error: describe(cause) });
      }
    };

    const attach = async (): Promise<void> => {
      try {
        const existing = await fetchState(slug);
        if (!alive()) return;

        if (settled(existing)) {
          publish({ state: existing, error: null });
          return;
        }

        const started = await requestGeneration(slug);
        if (!alive()) return;

        publish({ state: started, error: null });
        timer = setTimeout(() => void poll(), POLL_MS);
      } catch (cause) {
        publish({ state: null, error: describe(cause) });
      }
    };

    void attach();

    return () => {
      live.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  // Derived, not reset in an effect: a slug change blanks the view on the same render
  // that requests the new one, with no flash of the previous repo's card.
  const current = tracked.forSlug === (slug?.slug ?? null) ? tracked : EMPTY;
  return { state: current.state, error: current.error };
}
