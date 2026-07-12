import type { CSSProperties, JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InvalidSlugError, parseSlug, type RepoSlug } from '../shared/slug.js';
import { useJob } from './useJob.js';
import { Landing } from './screens/Landing.js';
import { Loading } from './screens/Loading.js';
import { Result } from './screens/Result.js';
import { Failed } from './screens/Failed.js';
import { Nav } from './screens/Nav.js';

function slugFromPath(pathname: string): RepoSlug | null {
  try {
    return parseSlug(pathname);
  } catch (error) {
    if (error instanceof InvalidSlugError) return null;
    throw error;
  }
}

export function App(): JSX.Element {
  const [slug, setSlug] = useState<RepoSlug | null>(() => slugFromPath(window.location.pathname));
  const { state, error, retry } = useJob(slug);

  // The route is the state, not a wizard step: back and forward have to work.
  useEffect(() => {
    const onPop = (): void => {
      setSlug(slugFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  const navigate = useCallback((next: RepoSlug | null): void => {
    window.history.pushState({}, '', next ? `/${next.slug}` : '/');
    setSlug(next);
  }, []);

  const screen = useMemo(() => {
    if (!slug) return <Landing onSubmit={navigate} />;
    if (error) return <Failed slug={slug} reason={error} onSubmit={navigate} onRetry={retry} />;
    if (state?.status === 'ready')
      return (
        <Result
          slug={slug}
          onHome={() => {
            navigate(null);
          }}
        />
      );
    if (state?.status === 'failed') {
      return <Failed slug={slug} errorCode={state.errorCode} onSubmit={navigate} onRetry={retry} />;
    }
    return <Loading slug={slug} />;
  }, [slug, state, error, navigate, retry]);

  // Before there is a story there is no colour to read it in, so the shell wears the brand.
  // Once the card exists the page takes its accent — a mint card beside a cyan button is two
  // products arguing, and the card is the one that has to win.
  const accent = state?.status === 'ready' ? (state.accent ?? null) : null;

  return (
    <div style={accent ? ({ '--accent': accent } as CSSProperties) : undefined}>
      <Nav
        onHome={() => {
          navigate(null);
        }}
      />
      {screen}
    </div>
  );
}
