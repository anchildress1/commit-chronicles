import { describe, expect, it } from 'vitest';
import { cardAltText, renderCard } from '../../src/server/card/svg.js';
import { PLOT_BOTTOM } from '../../src/server/card/layout.js';
import { CARD, cardWith, ts } from '../fixtures/card.js';

/**
 * The plotted commits only. The product mark and the attribution bullet are circles too,
 * and they live outside the scatter — counting them would make every assertion below lie.
 */
function dots(svg: string): { x: number; y: number }[] {
  return [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]), r: Number(match[3]) }))
    .filter((dot) => dot.y > 180 && dot.y < 560 && dot.r >= 4);
}

/** The y of every headline line. */
function headlineYs(svg: string): number[] {
  return [...svg.matchAll(/<text x="60" y="([\d.]+)" font-family="'Bodoni[^>]*>/g)].map((match) =>
    Number(match[1]),
  );
}

describe('renderCard', () => {
  it('renders a 1200×630 SVG', () => {
    const svg = renderCard(CARD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('paints every accented element with the hex Cortex chose', () => {
    const svg = renderCard(CARD);
    expect(svg).toContain('#e8a04a');
    // The card must not carry a brand colour Cortex did not pick.
    expect(svg).not.toContain('#ffb61e');
  });

  it('follows Cortex to a different accent for a different story', () => {
    const svg = renderCard(cardWith({ accent: '#d3e85a' }));
    expect(svg).toContain('#d3e85a');
    expect(svg).not.toContain('#e8a04a');
  });

  it('greys out a repo with no story rather than inventing a colour', () => {
    const svg = renderCard(cardWith({ storyline: 'none', accent: '#6b7280' }));
    expect(svg).toContain('#6b7280');
  });

  it('writes the kicker, the headline, and the italic accent fragment', () => {
    const svg = renderCard(CARD);
    expect(svg).toContain('THE DEATH OF A SIDE PROJECT');
    expect(svg).toContain('Born in daylight. Last touched at');
    expect(svg).toContain('font-style="italic" fill="#e8a04a"');
    expect(svg).toContain('3:53 in the morning');
  });

  it('composes the header meta from the facts, not from Cortex', () => {
    expect(renderCard(CARD)).toContain('59 COMMITS · ABANDONED SINCE FEB 25');
  });

  it('draws the void panel with the observed gap', () => {
    const svg = renderCard(CARD);
    expect(svg).toContain('38 days dark');
    expect(svg).toContain('DEC 27 — FEB 3');
  });

  it('omits the void panel when the history has no long silence', () => {
    const svg = renderCard(cardWith({ facts: { ...CARD.facts, largestGap: null } }));
    expect(svg).not.toContain('days dark');
  });

  it('prints the plain last-commit anchor when Cortex left the label empty', () => {
    expect(renderCard(CARD)).toContain('last commit · 3:53 AM');
  });

  it('uses Cortex’s last-commit label when the repo is still active', () => {
    const svg = renderCard(cardWith({ statusLabel: 'active', labelLast: 'still rewriting' }));
    expect(svg).toContain('still rewriting');
    expect(svg).not.toContain('last commit · 3:53 AM');
  });

  it('keeps every anchor label out of the scatter and on the rail', () => {
    const svg = renderCard(cardWith({ statusLabel: 'active', labelLast: 'still rewriting' }));

    // The rail sits above the plot; a label printed among the dots would be below it.
    const railY = [
      ...svg.matchAll(
        /<text x="[\d.]+" y="([\d.]+)"[^>]*font-family="'Space Mono[^>]*>(?:last commit|still rewriting)/g,
      ),
    ].map((match) => Number(match[1]));
    // dots() is plot-only. The product mark in the header is circles too, and counting it
    // here would measure the rail against the logo instead of the scatter.
    const dotYs = dots(svg).map((dot) => dot.y);

    expect(railY.length).toBeGreaterThan(0);
    expect(dotYs.length).toBeGreaterThan(0);
    expect(Math.max(...railY)).toBeLessThan(Math.min(...dotYs));
  });

  it('draws a leader line from each anchor label to the dot it names', () => {
    const svg = renderCard(CARD);
    expect(svg).toMatch(
      /<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="[^"]+" stroke-opacity="0.35"/,
    );
  });

  it('draws the pivot anchor only when the storyline uses one', () => {
    expect(renderCard(CARD)).not.toContain('came back');

    const resurrection = cardWith({
      storyline: 'resurrection',
      labelPivot: 'came back',
      pivotAt: ts('2026-02-03T01:58:00'),
    });
    expect(renderCard(resurrection)).toContain('came back');
  });

  it('credits the primary author, falling back to the name when there is no login', () => {
    expect(renderCard(CARD)).toContain('@rhea-okonkwo');

    const noLogin = cardWith({ facts: { ...CARD.facts, primaryAuthorLogin: null } });
    expect(renderCard(noLogin)).toContain('@Rhea Okonkwo');
  });

  it('states the disclosure sentence verbatim', () => {
    expect(renderCard(CARD)).toContain('Every dot is one commit, placed by the hour it landed.');
  });

  it('escapes a commit message that would otherwise close the SVG', () => {
    const hostile = cardWith({ kicker: '<script>alert("x")</script>' });
    const svg = renderCard(hostile);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;SCRIPT&gt;');
  });

  it('refuses an accent that is not a hex colour', () => {
    const svg = renderCard(cardWith({ accent: 'javascript:alert(1)' }));
    expect(svg).not.toContain('javascript:');
    expect(svg).toContain('#6b7280');
  });

  it('renders a one-commit repo without dividing by zero', () => {
    const single = cardWith({
      plot: CARD.plot.slice(0, 1),
      facts: {
        ...CARD.facts,
        commitCount: 1,
        firstCommitAt: CARD.plot[0]!.t,
        lastCommitAt: CARD.plot[0]!.t,
        largestGap: null,
      },
    });
    expect(() => renderCard(single)).not.toThrow();
    expect(renderCard(single)).toContain('1 COMMIT ·');
  });

  it('emits no NaN coordinates', () => {
    expect(renderCard(CARD)).not.toContain('NaN');
  });

  it('keeps the headline clear of the scatter, even at three lines', () => {
    const svg = renderCard(CARD);
    const lowestHeadline = Math.max(...headlineYs(svg));
    const plotted = dots(svg);

    expect(plotted.length).toBeGreaterThan(0);
    expect(Math.min(...plotted.map((dot) => dot.y))).toBeGreaterThan(lowestHeadline);
  });

  it('keeps a long headline from pushing the scatter off the card', () => {
    const wordy = cardWith({
      headlineUpright: 'It began in the daylight and it ended in the',
      headlineAccent: 'small hours of a Tuesday nobody remembers now',
      headlineTrail: '.',
    });
    const svg = renderCard(wordy);
    const plotted = dots(svg);

    expect(Math.max(...plotted.map((dot) => dot.y))).toBeLessThanOrEqual(PLOT_BOTTOM);
    expect(Math.min(...plotted.map((dot) => dot.y))).toBeGreaterThan(Math.max(...headlineYs(svg)));
  });
});

describe('cardAltText', () => {
  it('carries the story for a reader who cannot see the image', () => {
    const alt = cardAltText(CARD);
    expect(alt).toContain('atlas/pipeline');
    expect(alt).toContain('the death of a side project');
    expect(alt).toContain('3:53 in the morning');
  });

  it('is embedded in the SVG as an accessible label', () => {
    expect(renderCard(CARD)).toContain('role="img"');
    expect(renderCard(CARD)).toContain('aria-label=');
  });
});
