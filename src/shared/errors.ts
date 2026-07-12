/**
 * Why a generation failed, and whether asking again could ever change the answer.
 *
 * Shared, because the server decides whether to admit a retry and the page decides whether
 * to offer one. If those two ever disagree, the page offers a button that does nothing.
 */

/**
 * Failures that are a property of the repository. Retrying one spends a Cortex call to
 * learn exactly what we already know, so these are cached and never re-run — that cache is
 * what stops a bad slug being retried into a bill.
 */
const TERMINAL_ERRORS = new Set([
  'repo_not_found',
  'repo_private',
  'repo_empty',
  'repo_too_large',
  'no_commits',
]);

/**
 * Everything else is our fault, not the repo's: the model returned a draft that failed
 * validation, or the pipeline fell over. Cortex is non-deterministic, so the next draft
 * genuinely can pass — caching these permanently would condemn a perfectly good repository
 * over one sentence that ran a character long.
 */
export function isRetryable(errorCode: string | undefined): boolean {
  return errorCode !== undefined && !TERMINAL_ERRORS.has(errorCode);
}
