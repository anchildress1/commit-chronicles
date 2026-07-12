import { describe, expect, it } from 'vitest';
import { isRetryable } from '../../src/shared/errors.js';

describe('isRetryable', () => {
  it.each(['repo_not_found', 'repo_private', 'repo_empty', 'repo_too_large', 'no_commits'])(
    '%s is the repository’s answer, and asking again cannot change it',
    (errorCode) => {
      expect(isRetryable(errorCode)).toBe(false);
    },
  );

  it.each(['cortex_rejected', 'cortex_empty', 'pipeline_error'])(
    '%s is ours, and the next attempt can genuinely succeed',
    (errorCode) => {
      expect(isRetryable(errorCode)).toBe(true);
    },
  );

  it('offers no retry when there is no error code to reason about', () => {
    expect(isRetryable(undefined)).toBe(false);
  });

  it('treats an unrecognised code as ours rather than blaming the repo', () => {
    expect(isRetryable('something_new')).toBe(true);
  });
});
