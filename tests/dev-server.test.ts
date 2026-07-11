import { describe, expect, it } from 'vitest';
import config from '../vite.config.js';

/**
 * The dev server's proxy table, guarded because both of its rules exist to fix a bug that
 * only shows up when you actually run `make dev` — and neither is reachable from the E2E
 * suite, which stubs the network out entirely.
 */
function proxyKeys(): string[] {
  const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy;
  return Object.keys(proxy ?? {});
}

const matches = (path: string): boolean =>
  proxyKeys().some((pattern) => new RegExp(pattern).test(path));

describe('dev server proxy', () => {
  it('sends API calls to the backend', () => {
    expect(matches('/api/generate')).toBe(true);
    expect(matches('/api/state/atlas/pipeline')).toBe(true);
  });

  it('sends the card to the backend, which is the only thing that can render it', () => {
    // Unproxied, the SPA fallback answers with index.html and the preview is a broken image.
    expect(matches('/atlas/pipeline/card.svg')).toBe(true);
    expect(matches('/anchildress1/rai-lint/card.svg')).toBe(true);
  });

  it('does not swallow the client’s own /api.ts module', () => {
    // A bare '/api' prefix matches this too, and proxying it away stops the SPA booting.
    expect(matches('/api.ts')).toBe(false);
    expect(matches('/src/client/api.ts')).toBe(false);
  });

  it('leaves ordinary SPA routes to the SPA', () => {
    expect(matches('/')).toBe(false);
    expect(matches('/atlas/pipeline')).toBe(false);
  });
});
