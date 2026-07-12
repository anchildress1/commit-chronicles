import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { RepoSlug } from '../../shared/slug.js';
import { embedMarkdown } from '../api.js';

interface ResultProps {
  slug: RepoSlug;
  /** The card's public bucket URL, from the ready state. */
  cardUrl: string;
  onHome: () => void;
}

type CopyState = 'idle' | 'copied' | 'refused';

function useCopy(): [CopyState, (value: string) => void] {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The flag resets on a timer. Leaving on a click strands it, and it fires into a component
  // that no longer exists.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (value: string): void => {
    // Claimed only once the write resolves. A browser that refuses the clipboard must not be
    // answered with a tick, or the reader pastes the last thing they copied somewhere else.
    void navigator.clipboard.writeText(value).then(
      () => {
        settle('copied');
      },
      () => {
        settle('refused');
      },
    );
  };

  const settle = (next: CopyState): void => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState('idle');
    }, 1600);
  };

  return [state, copy];
}

const LABEL: Record<CopyState, (idle: string) => string> = {
  idle: (idle) => idle,
  copied: () => '✓ copied',
  refused: () => 'clipboard refused — select it',
};

/** The card is the product, so it gets the page. Everything else is chrome. */
export function Result({ slug, cardUrl, onHome }: ResultProps): JSX.Element {
  const origin = window.location.origin;
  const [imageCopy, copyImage] = useCopy();
  const [embedCopy, copyEmbed] = useCopy();

  const embed = embedMarkdown(slug, origin, cardUrl);

  return (
    <main className="stage stage--result">
      <p className="address">
        <span className="address__dot" aria-hidden="true" />
        <span className="address__host">commitchronicles.dev/</span>
        <span>{slug.slug}</span>
      </p>

      <div className="card-frame">
        {/* Straight from the bucket — byte-for-byte the image a README will show. */}
        <img src={cardUrl} alt={`Commit Chronicles card for ${slug.slug}`} />
      </div>

      <div className="takeaway">
        <div className="takeaway__buttons">
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              copyImage(cardUrl);
            }}
          >
            {LABEL[imageCopy]('Copy image URL')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              copyEmbed(embed);
            }}
          >
            {LABEL[embedCopy]('Copy README embed')}
          </button>
        </div>

        <div className="takeaway__embed">
          <p className="actions__label">Embed in your README</p>
          <code className="embed">{embed}</code>
        </div>
      </div>

      <button type="button" className="btn-quiet" onClick={onHome}>
        ← read another repo
      </button>
    </main>
  );
}
