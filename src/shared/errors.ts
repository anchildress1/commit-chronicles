// Shared: the server admits the retry, the page offers it. If they disagree the page shows
// a button that does nothing.

/** Failures the repo will give the same answer to forever. Cached, never re-run. */
const TERMINAL_ERRORS = new Set([
  'repo_not_found',
  'repo_private',
  'repo_empty',
  'repo_too_large',
  'no_commits',
]);

/** Everything else is ours. Cortex is non-deterministic, so the next draft can pass. */
export function isRetryable(errorCode: string | undefined): boolean {
  return errorCode !== undefined && !TERMINAL_ERRORS.has(errorCode);
}
