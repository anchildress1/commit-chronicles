import type { JSX } from 'react';
import { useState } from 'react';
import type { RepoSlug } from '../../shared/slug.js';
import { cardUrl, embedMarkdown } from '../api.js';

interface ResultProps {
  slug: RepoSlug;
  onHome: () => void;
}

function useCopy(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = (value: string): void => {
    // A denied clipboard permission must not take the page down with it.
    void navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1600);
  };

  return [copied, copy];
}

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

      <div className="result__head">
        <p className="eyebrow" style={{ marginBottom: 0 }}>
          Your card is ready
        </p>
        <h2 className="display display--sub">github.com/{slug.slug}, as a story.</h2>
      </div>

      <div className="result__grid">
        <div>
          <div className="card-frame">
            {/* The preview is the card the bucket serves, not a second rendering of it —
                what a judge sees here is byte-for-byte what lands in the README. */}
            <img src={cardUrl(slug)} alt={`Commit Chronicles card for ${slug.slug}`} />
          </div>
          <p className="card-note">1200 × 630 · social + README preview size</p>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              copyImage(`${origin}${cardUrl(slug)}`);
            }}
          >
            {imageCopied ? '✓ copied' : 'Copy card image'}
          </button>

          <div style={{ marginTop: 12 }}>
            <p className="actions__label">Embed in your README</p>
            <code className="embed">{embed}</code>
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

          <button type="button" className="btn-quiet" onClick={onHome}>
            ← read another repo
          </button>
        </div>
      </div>
    </main>
  );
}
