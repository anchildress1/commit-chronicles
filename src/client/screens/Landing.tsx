import type { JSX } from 'react';
import { parseSlug, type RepoSlug } from '../../shared/slug.js';
import { RepoEntry } from './RepoEntry.js';

interface LandingProps {
  onSubmit: (slug: RepoSlug) => void;
}

/** Pre-generated, so a judge clicking one never waits on a cold Cortex call. */
// Three passion projects, three different storylines: a binge, a nocturne, a relapse. The
// detector reads a personal arc, so a repo with a team behind it has nothing for it to find —
// forem and linux both came back "no story here", which is true and a terrible advertisement.
export const EXAMPLES = [
  'anchildress1/save-the-sun',
  'anchildress1/carbon-trace',
  'anchildress1/legacy-smelter',
];

export function Landing({ onSubmit }: Readonly<LandingProps>): JSX.Element {
  return (
    <main className="stage">
      <p className="eyebrow" data-anim style={{ animationDelay: '0s' }}>
        Powered by Snowflake Cortex
      </p>

      <h1 className="display" data-anim style={{ animationDelay: '0.08s' }}>
        Every repo is a story.
        <br />
        Post the <em>story.</em>
      </h1>

      <p className="lede" data-anim style={{ animationDelay: '0.16s' }}>
        Paste a GitHub repository. It reads the whole commit history, finds the one story actually
        in there, and turns it into a card you can drop straight into your README.
      </p>

      <div className="entry" data-anim style={{ animationDelay: '0.24s' }}>
        <RepoEntry onSubmit={onSubmit} submitLabel="Read →" />

        <div className="examples">
          <span className="examples__label">Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => {
                onSubmit(parseSlug(example));
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <p className="fineprint" data-anim style={{ animationDelay: '0.32s' }}>
        Reads public commit history only · the card it makes is public
      </p>
    </main>
  );
}
