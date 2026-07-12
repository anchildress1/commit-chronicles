import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAILURE_COPY } from '../../src/client/screens/Failed.js';
import { isRetryable } from '../../src/shared/errors.js';

const ROOT = join(import.meta.dirname, '../..');

/**
 * Every error code the pipeline can hand the page.
 *
 * Scraped from the source rather than listed by hand: a list would drift the moment someone
 * adds a code, which is exactly the bug this guards. `repo_oversized` shipped with the page
 * having no words for it because the copy map had invented its own name for the code.
 */
function emittedErrorCodes(): string[] {
  const sources = [
    ...readdirSync(join(ROOT, 'snowflake'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => join(ROOT, 'snowflake', name)),
    ...readdirSync(join(ROOT, 'src/server'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(ROOT, 'src/server', name)),
  ];

  // Three shapes emit a code: a JSON literal, Snowflake's OBJECT_CONSTRUCT pair (comma, not
  // colon), and the server's markFailed call.
  const patterns = [
    /["']?errorCode["']?\s*[:,]\s*["']([a-z_]+)["']/g,
    /markFailed\([^)]*["']([a-z_]+)["']\s*\)/g,
  ];

  const codes = new Set<string>();
  for (const path of sources) {
    const text = readFileSync(path, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) codes.add(match[1]!);
    }
  }
  return [...codes].sort();
}

describe('failure copy', () => {
  it('finds the codes it is supposed to be checking', () => {
    const codes = emittedErrorCodes();
    expect(codes).toContain('repo_not_found');
    expect(codes.length).toBeGreaterThan(3);
  });

  it('no longer refuses a repo for being too big', () => {
    // A large history is windowed, not rejected. The code is gone from the pipeline, so the
    // page must not still be carrying words for it.
    expect(emittedErrorCodes()).not.toContain('repo_oversized');
    expect(FAILURE_COPY['repo_oversized']).toBeUndefined();
  });

  it('has words for every code the pipeline emits', () => {
    const missing = emittedErrorCodes().filter((code) => !(code in FAILURE_COPY));
    expect(missing).toEqual([]);
  });

  it('carries no copy for a code nothing emits', () => {
    // The dead `repo_too_large` key is how the live `repo_oversized` went unnoticed: the map
    // looked full. Copy for a code that cannot happen is how copy for one that can goes missing.
    const emitted = new Set(emittedErrorCodes());
    const orphans = Object.keys(FAILURE_COPY).filter((code) => !emitted.has(code));
    expect(orphans).toEqual([]);
  });

  it('never tells the reader to re-check a name that was right', () => {
    // Only a failure that really is about the name may send the reader back to the name.
    expect(FAILURE_COPY['repo_private']?.explain).not.toMatch(/check the owner/i);
    expect(FAILURE_COPY['no_commits']?.explain).not.toMatch(/check the owner/i);
  });

  it('offers no retry for a failure that will answer the same way forever', () => {
    expect(isRetryable('repo_not_found')).toBe(false);
    expect(isRetryable('invalid_repo_slug')).toBe(false);
  });

  it('still offers a retry for a failure that is ours', () => {
    expect(isRetryable('cortex_rejected')).toBe(true);
    expect(isRetryable('pipeline_error')).toBe(true);
  });
});
