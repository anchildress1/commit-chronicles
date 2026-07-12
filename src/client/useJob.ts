import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoSlug } from '../shared/slug.js';
import { QuotaExceededError, fetchState, requestGeneration, type JobState } from './api.js';

const POLL_MS = 2500;
/** A generation that has not landed in five minutes is not going to. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface Job {
  state: JobState | null;
  error: string | null;
  /** Ask for another generation. Only meaningful on a failure the server will re-run. */
  retry: () => void;
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
  return 'That could not be read just now. Try again in a moment.';
}

const settled = (state: JobState): boolean => state.status === 'ready' || state.status === 'failed';

/**
 * Attach to the job for `slug`, generating one only when the bucket has nothing.
 *
 * Reading the state first means returning to a page never re-runs Cortex, and a repo
 * someone else already read costs nothing to show.
 */
export function useJob(slug: RepoSlug | null): Job {
  const [tracked, setTracked] = useState<Tracked>(EMPTY);
  /** Bumped by retry(). Re-runs the effect for a slug the hook is already attached to. */
  const [attempt, setAttempt] = useState(0);
  const forced = useRef(false);

  const retry = useCallback(() => {
    // A cached failure is settled, so attach would just re-show it. This asks anyway; the
    // server still decides whether it will re-run.
    forced.current = true;
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!slug) return;

    // Read through a call: a plain flag narrows to dead code after the first check.
    const live = { current: true };
    const alive = (): boolean => live.current;
    const force = forced.current;
    forced.current = false;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const publish = (next: Omit<Tracked, 'forSlug'>): void => {
      // Tagged with its slug, so a late response can never paint the wrong repo's card.
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

        if (settled(existing) && !force) {
          publish({ state: existing, error: null });
          return;
        }

        const started = await requestGeneration(slug);
        if (!alive()) return;

        publish({ state: started, error: null });

        // A refused retry comes back already-failed. Polling it would spin forever.
        if (settled(started)) return;

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
  }, [slug, attempt]);

  // Derived, not reset in an effect: no flash of the previous repo's card on a slug change.
  const current = tracked.forSlug === (slug?.slug ?? null) ? tracked : EMPTY;
  return { state: current.state, error: current.error, retry };
}
