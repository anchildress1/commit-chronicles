/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useJob } from '../../src/client/useJob.js';
import { parseSlug } from '../../src/shared/slug.js';

const SLUG = parseSlug('atlas/pipeline');

interface Call {
  url: string;
  method: string;
}

function router(handlers: {
  state: () => unknown;
  generate?: () => { status: number; body: unknown };
}): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });

      if (url === '/api/generate') {
        const response = handlers.generate?.() ?? {
          status: 202,
          body: { status: 'generating', repo: 'atlas/pipeline' },
        };
        return Promise.resolve(
          new Response(JSON.stringify(response.body), { status: response.status }),
        );
      }

      return Promise.resolve(new Response(JSON.stringify(handlers.state()), { status: 200 }));
    }),
  );

  return calls;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useJob', () => {
  it('does nothing without a slug', async () => {
    const calls = router({ state: () => ({ status: 'unknown' }) });

    const { result } = renderHook(() => useJob(null));

    expect(result.current.state).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(0);
  });

  it('shows a cached card without asking for a generation', async () => {
    const calls = router({
      state: () => ({ status: 'ready', repo: 'atlas/pipeline', accent: '#e8a04a' }),
    });

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.state?.status).toBe('ready');
    });
    expect(calls.some((call) => call.url === '/api/generate')).toBe(false);
  });

  it('shows a cached failure without asking for a generation', async () => {
    const calls = router({
      state: () => ({ status: 'failed', repo: 'atlas/pipeline', errorCode: 'repo_not_found' }),
    });

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.state?.status).toBe('failed');
    });
    expect(calls.some((call) => call.url === '/api/generate')).toBe(false);
  });

  it('asks for a generation on a cold repo, then polls until the card lands', async () => {
    let reads = 0;
    const calls = router({
      state: () => {
        reads += 1;
        return reads > 2
          ? { status: 'ready', repo: 'atlas/pipeline', accent: '#d3e85a' }
          : { status: 'unknown', repo: 'atlas/pipeline' };
      },
    });

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.state?.status).toBe('generating');
    });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => {
      expect(result.current.state?.status).toBe('ready');
    });
    expect(result.current.state?.accent).toBe('#d3e85a');
  });

  it('reports the quota cap in words the reader can act on', async () => {
    router({
      state: () => ({ status: 'unknown', repo: 'atlas/pipeline' }),
      generate: () => ({ status: 429, body: { error: 'quota_exceeded' } }),
    });

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.error).toMatch(/generation budget/);
    });
  });

  it('reports an unreachable backend rather than spinning forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.error).toMatch(/could not be reached/);
    });
  });

  it('stops polling once the component unmounts', async () => {
    const calls = router({ state: () => ({ status: 'unknown', repo: 'atlas/pipeline' }) });

    const { result, unmount } = renderHook(() => useJob(SLUG));
    await waitFor(() => {
      expect(result.current.state?.status).toBe('generating');
    });

    const before = calls.length;
    unmount();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls.length).toBe(before);
  });
});
