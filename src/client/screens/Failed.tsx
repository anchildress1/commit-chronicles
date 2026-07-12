import type { JSX } from 'react';
import type { RepoSlug } from '../../shared/slug.js';
import { isRetryable } from '../../shared/errors.js';
import { RepoEntry } from './RepoEntry.js';

interface FailedProps {
  slug: RepoSlug;
  onSubmit: (slug: RepoSlug) => void;
  onRetry: () => void;
  errorCode?: string | undefined;
  reason?: string | undefined;
}

/**
 * Snowflake's error codes, said out loud. A repo that could not be read gets a straight
 * answer about why — not a spinner that quietly gives up.
 */
const HEADLINE: Record<string, string> = {
  repo_not_found: 'Nothing to read here.',
  repo_private: 'That one is locked.',
  repo_empty: 'It never drew breath.',
  repo_too_large: 'That history is too big to read.',
  no_commits: 'Nothing but bots.',
  cortex_empty: 'The reading came back blank.',
  cortex_rejected: 'The reading came back wrong.',
  pipeline_error: 'Something broke on our side.',
};

const EXPLAIN: Record<string, string> = {
  repo_not_found:
    'That repository has no public commits — a wrong name, a private repo, or one that never drew breath. Check the owner and name and try again.',
  repo_private: 'Commit Chronicles reads public repositories only.',
  repo_empty: 'The repository exists, but there is not a single commit in it.',
  repo_too_large:
    'The commit history is past the cap this service will ingest. Try a smaller repository.',
  no_commits:
    'Every commit in that repository is a merge or a bot. There is no human history to read.',
  cortex_empty: 'Cortex returned nothing usable. This is on us — the next reading may land.',
  cortex_rejected:
    'Cortex wrote a card that would not fit the frame, so we threw it away rather than print a broken one. It writes a fresh one every time, so reading again usually works.',
  pipeline_error: 'The generation pipeline fell over. This is on us — reading again may work.',
};

const FALLBACK_HEADLINE = 'Nothing to read here.';
const FALLBACK_EXPLAIN =
  'That repository could not be read. Check the owner and name and try again.';

export function Failed({ slug, onSubmit, onRetry, errorCode, reason }: FailedProps): JSX.Element {
  const headline = (errorCode && HEADLINE[errorCode]) ?? FALLBACK_HEADLINE;
  const explain = reason ?? (errorCode && EXPLAIN[errorCode]) ?? FALLBACK_EXPLAIN;

  // Only offer a retry the server will actually honour. A button that re-shows the same
  // cached failure is worse than no button.
  const canRetry = isRetryable(errorCode);

  return (
    <main className="stage">
      <p className="slug">
        github.com/<b>{slug.slug}</b>
      </p>

      <h2 className="display display--sub" style={{ maxWidth: '18ch', marginInline: 'auto' }}>
        {headline}
      </h2>

      <p className="reason" role="alert">
        {explain}
      </p>

      {canRetry ? (
        <div className="retry">
          <button type="button" className="btn-primary btn-block" onClick={onRetry}>
            Read it again
          </button>
          <p className="retry__note">or read a different repository</p>
        </div>
      ) : null}

      <div className="entry" style={{ maxWidth: 520 }}>
        <RepoEntry onSubmit={onSubmit} submitLabel={canRetry ? 'Read' : 'Try again'} />
      </div>
    </main>
  );
}
