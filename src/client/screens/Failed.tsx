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

interface FailureCopy {
  headline: string;
  explain: string;
}

/**
 * Every error code the pipeline can emit, said out loud.
 *
 * A code with no entry here falls back to copy that blames the repository's name, which for
 * a failure like `repo_oversized` sends the reader off to re-check a name that was correct.
 */
export const FAILURE_COPY: Record<string, FailureCopy> = {
  repo_not_found: {
    headline: 'Nothing to read here.',
    explain:
      'That repository has no public commits — a wrong name, a private repo, or one that never drew breath. Check the owner and name and try again.',
  },
  repo_private: {
    headline: 'That one is locked.',
    explain: 'Commit Chronicles reads public repositories only.',
  },
  repo_empty: {
    headline: 'It never drew breath.',
    explain: 'The repository exists, but there is not a single commit in it.',
  },
  repo_oversized: {
    headline: 'That history is too big to read.',
    explain:
      'The repository is real and public — there is just more history in it than this service will ingest. Nothing is wrong with the name. Try a smaller repository.',
  },
  invalid_repo_slug: {
    headline: 'That is not a repository.',
    explain: 'That is not a valid owner/repo. Check the spelling and try again.',
  },
  no_commits: {
    headline: 'Nothing but bots.',
    explain:
      'Every commit in that repository is a merge or a bot. There is no human history to read.',
  },
  cortex_empty: {
    headline: 'The reading came back blank.',
    explain: 'Cortex returned nothing usable. This is on us — the next reading may land.',
  },
  cortex_rejected: {
    headline: 'The reading came back wrong.',
    explain:
      'Cortex returned a card that would have printed something untrue, so we threw it away. It writes a fresh one every time — reading again usually works.',
  },
  pipeline_error: {
    headline: 'Something broke on our side.',
    explain: 'The generation pipeline fell over. This is on us — reading again may work.',
  },
};

const FALLBACK: FailureCopy = {
  headline: 'Nothing to read here.',
  explain: 'That repository could not be read. Check the owner and name and try again.',
};

export function Failed({
  slug,
  onSubmit,
  onRetry,
  errorCode,
  reason,
}: Readonly<FailedProps>): JSX.Element {
  const copy = (errorCode === undefined ? undefined : FAILURE_COPY[errorCode]) ?? FALLBACK;
  const explain = reason ?? copy.explain;

  // Only offer a retry the server will honour: a button that re-shows a cached failure lies.
  const canRetry = isRetryable(errorCode);

  return (
    <main className="stage">
      <p className="slug">
        github.com/<b>{slug.slug}</b>
      </p>

      <h2 className="display display--sub" style={{ maxWidth: '18ch', marginInline: 'auto' }}>
        {copy.headline}
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
