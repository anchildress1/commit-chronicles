/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
      state: () => ({ status: 'ready', repo: 'atlas/pipeline' }),
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
          ? { status: 'ready', repo: 'atlas/pipeline' }
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

    // Reads are retried before the page calls it, so the clock has to reach the last one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 2500);
    });

    expect(result.current.error).toMatch(/could not be read just now/);
  });

  it('rides out a single refused read instead of failing a job that is still running', async () => {
    // The API restarting under `make dev` refuses the poll that is already in flight. Calling
    // that a failure reports a dead job while it is busy succeeding.
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/generate') {
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'generating', repo: 'atlas/pipeline' }), {
              status: 202,
            }),
          );
        }
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('ECONNREFUSED'));
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'ready', repo: 'atlas/pipeline' }), {
            status: 200,
          }),
        );
      }),
    );

    const { result } = renderHook(() => useJob(SLUG));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    await waitFor(() => {
      expect(result.current.state?.status).toBe('ready');
    });
    expect(result.current.error).toBeNull();
  });

  it('keeps showing the job while a read is merely blipping', async () => {
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/generate') {
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'generating', repo: 'atlas/pipeline' }), {
              status: 202,
            }),
          );
        }
        reads += 1;
        // The first read attaches; every later poll is refused.
        if (reads === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ status: 'unknown', repo: 'atlas/pipeline' }), {
              status: 200,
            }),
          );
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }),
    );

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.state?.status).toBe('generating');
    });

    // Two refused polls is not yet a verdict: the page still shows the running job.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 2500);
    });

    expect(result.current.state?.status).toBe('generating');
    expect(result.current.error).toBeNull();
  });

  it('does not re-run a cached failure on its own', async () => {
    const calls = router({
      state: () => ({ status: 'failed', repo: 'atlas/pipeline', errorCode: 'cortex_rejected' }),
    });

    const { result } = renderHook(() => useJob(SLUG));

    await waitFor(() => {
      expect(result.current.state?.status).toBe('failed');
    });
    // Landing on a failed page must not spend a Cortex call. Only the reader asks.
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('retry() actually asks for another generation', async () => {
    let generated = false;
    const calls = router({
      state: () =>
        generated
          ? { status: 'ready', repo: 'atlas/pipeline' }
          : { status: 'failed', repo: 'atlas/pipeline', errorCode: 'cortex_rejected' },
      generate: () => {
        generated = true;
        return { status: 202, body: { status: 'generating', repo: 'atlas/pipeline' } };
      },
    });

    const { result } = renderHook(() => useJob(SLUG));
    await waitFor(() => {
      expect(result.current.state?.status).toBe('failed');
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    // The retry polls on the same cadence as a first read.
    await vi.advanceTimersByTimeAsync(6000);

    await waitFor(() => {
      expect(result.current.state?.status).toBe('ready');
    });
  });

  it('does not spin when the server refuses the retry', async () => {
    // A terminal failure comes straight back from POST. Polling it would never settle.
    const calls = router({
      state: () => ({ status: 'failed', repo: 'atlas/pipeline', errorCode: 'repo_not_found' }),
      generate: () => ({
        status: 200,
        body: { status: 'failed', repo: 'atlas/pipeline', errorCode: 'repo_not_found' },
      }),
    });

    const { result } = renderHook(() => useJob(SLUG));
    await waitFor(() => {
      expect(result.current.state?.status).toBe('failed');
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    const before = calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(before);
    expect(result.current.state?.status).toBe('failed');
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

    expect(calls).toHaveLength(before);
  });
});
