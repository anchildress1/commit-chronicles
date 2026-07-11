import type { CSSProperties, JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InvalidSlugError, parseSlug, type RepoSlug } from '../shared/slug.js';
import { useJob } from './useJob.js';
import { Landing } from './screens/Landing.js';
import { Loading } from './screens/Loading.js';
import { Result } from './screens/Result.js';
import { Failed } from './screens/Failed.js';
import { Nav } from './screens/Nav.js';

/** The shell's colour until a card exists. Cortex owns every accent after that. */
const BRAND_ACCENT = '#ffb61e';

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
  const { state, error } = useJob(slug);

  // The URL is the address of a story, so back and forward have to work: the route is
  // the state, not a step in a wizard.
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

  const accent = state?.status === 'ready' && state.accent ? state.accent : BRAND_ACCENT;

  const screen = useMemo(() => {
    if (!slug) return <Landing onSubmit={navigate} />;
    if (error) return <Failed slug={slug} reason={error} onSubmit={navigate} />;
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
      return <Failed slug={slug} errorCode={state.errorCode} onSubmit={navigate} />;
    }
    return <Loading slug={slug} />;
  }, [slug, state, error, navigate]);

  return (
    <div style={{ '--accent': accent } as CSSProperties}>
      <Nav
        onHome={() => {
          navigate(null);
        }}
      />
      {screen}
    </div>
  );
}
