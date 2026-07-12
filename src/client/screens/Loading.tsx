import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { RepoSlug } from '../../shared/slug.js';

interface LoadingProps {
  slug: RepoSlug;
}

const LINES = [
  'fetching the commit log…',
  'reading the history…',
  'rotating the clock — night to the floor…',
  'finding the quiet stretches…',
  'drawing the card…',
];

/** Deterministic, so the dots do not reshuffle on every re-render. */
const DOTS = Array.from({ length: 11 }, (_, i) => ({
  x: 6 + i * 8.6,
  y: 30 + Math.sin(i * 0.9) * 22 + i * 3,
  delay: i * 0.16,
}));

export function Loading({ slug }: Readonly<LoadingProps>): JSX.Element {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const ticker = setInterval(() => {
      setIndex((current) => current + 1);
    }, 900);
    return () => {
      clearInterval(ticker);
    };
  }, []);

  return (
    <main className="stage" aria-live="polite" aria-busy="true">
      <p className="slug">
        github.com/<b>{slug.slug}</b>
      </p>

      <h2 className="display display--sub">Cortex is reading the history</h2>

      <div className="scan" aria-hidden="true">
        <span className="scan__beam" />
        {DOTS.map((dot) => (
          <span
            key={dot.x}
            className="scan__dot"
            style={{ left: `${dot.x}%`, top: `${dot.y}%`, animationDelay: `${dot.delay}s` }}
          />
        ))}
      </div>

      <p className="ticker">
        {LINES[index % LINES.length]}
        <span className="ticker__caret" aria-hidden="true">
          _
        </span>
      </p>

      <p className="fineprint">one pass over the commit log · leave the tab, it keeps going</p>
    </main>
  );
}
