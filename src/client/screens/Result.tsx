import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { RepoSlug } from '../../shared/slug.js';
import { embedMarkdown } from '../api.js';

interface ResultProps {
  slug: RepoSlug;
  /** The card's public bucket URL, from the ready state. */
  cardUrl: string;
  /** The repo's page on the real site, from the ready state. */
  pageUrl: string;
  onHome: () => void;
}

type CopyState = 'idle' | 'copied' | 'refused';

/**
 * The pre-secure-context way to copy. Deprecated, and the only thing that works over plain
 * HTTP — which is the exact case the Clipboard API leaves with nothing.
 *
 * @returns Whether the text reached the clipboard.
 */
function legacyCopy(value: string): boolean {
  const field = document.createElement('textarea');
  field.value = value;
  // Off-screen rather than hidden: the selection has to be real for the copy to take.
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.appendChild(field);

  try {
    field.select();
    // Deprecated, and still the only clipboard write available outside a secure context.
    // The modern API is tried first and this only runs when it is absent or refuses.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

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
    // navigator.clipboard exists only in a secure context, so it is simply absent when the
    // page is served over plain HTTP — reaching the dev server on a LAN address to test a
    // phone, for one. Calling through it then throws synchronously and never rejects, which
    // is how the 'refused' state below became unreachable in the one case that needs it.
    // lib.dom types `clipboard` as always present. It is not, and believing the type is what
    // left the button doing nothing at all over HTTP. Partial<> restores the truth so the
    // check below is a real one rather than dead code the linter is right to flag.
    const { clipboard } = navigator as Partial<Navigator>;

    if (!clipboard?.writeText) {
      settle(legacyCopy(value) ? 'copied' : 'refused');
      return;
    }

    // Claimed only once the write resolves. A browser that refuses the clipboard must not be
    // answered with a tick, or the reader pastes the last thing they copied somewhere else.
    void clipboard.writeText(value).then(
      () => {
        settle('copied');
      },
      () => {
        settle(legacyCopy(value) ? 'copied' : 'refused');
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
export function Result({ slug, cardUrl, pageUrl, onHome }: Readonly<ResultProps>): JSX.Element {
  const [imageCopy, copyImage] = useCopy();
  const [embedCopy, copyEmbed] = useCopy();

  const embed = embedMarkdown(cardUrl, pageUrl);

  return (
    <main className="stage stage--result">
      <p className="address">
        <span className="address__dot" aria-hidden="true" />
        <span className="address__host">{new URL(pageUrl).host}/</span>
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
