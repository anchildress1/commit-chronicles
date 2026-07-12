import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { RepoSlug } from '../../shared/slug.js';
import { cardUrl, embedMarkdown } from '../api.js';

interface ResultProps {
  slug: RepoSlug;
  onHome: () => void;
}

function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The "copied" flag resets on a timer. Leaving on a click strands it, and it fires into
  // a component that no longer exists.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (value: string): void => {
    // A denied clipboard permission must not take the page down with it.
    void navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(true);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, 1600);
  };

  return [copied, copy];
}

/** The card is the product, so it gets the page. Everything else is chrome. */
export function Result({ slug, onHome }: ResultProps): JSX.Element {
  const origin = window.location.origin;
  const [imageCopied, copyImage] = useCopy();
  const [embedCopied, copyEmbed] = useCopy();

  const embed = embedMarkdown(slug, origin);

  return (
    <main className="stage stage--result">
      <p className="address">
        <span className="address__dot" aria-hidden="true" />
        <span className="address__host">commitchronicles.dev/</span>
        <span>{slug.slug}</span>
      </p>

      <div className="card-frame">
        {/* The card the bucket serves, not a second rendering: byte-for-byte the README's. */}
        <img src={cardUrl(slug)} alt={`Commit Chronicles card for ${slug.slug}`} />
      </div>

      <div className="takeaway">
        <div className="takeaway__buttons">
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              copyImage(`${origin}${cardUrl(slug)}`);
            }}
          >
            {imageCopied ? '✓ copied' : 'Copy card image'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              copyEmbed(embed);
            }}
          >
            {embedCopied ? '✓ copied markdown' : 'Copy README embed'}
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
