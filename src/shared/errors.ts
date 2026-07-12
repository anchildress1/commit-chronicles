// Shared: the server admits the retry, the page offers it. If they disagree the page shows
// a button that does nothing.

/** Failures the repo will give the same answer to forever. Cached, never re-run. */
const TERMINAL_ERRORS = new Set([
  'repo_not_found',
  'repo_private',
  'repo_empty',
  // The code INGEST_REPO_COMMITS actually returns past the commit cap.
  'repo_oversized',
  'no_commits',
]);

/**
 * True when a failed generation is worth running again.
 *
 * Everything outside {@link TERMINAL_ERRORS} is ours, not the repository's, and Cortex is
 * non-deterministic — the next draft can pass where the last one did not.
 *
 * @param errorCode The `errorCode` from a failed job state, if there is one.
 * @returns False for a terminal failure and for an absent code.
 */
export function isRetryable(errorCode: string | undefined): boolean {
  return errorCode !== undefined && !TERMINAL_ERRORS.has(errorCode);
}
