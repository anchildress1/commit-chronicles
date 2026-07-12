import { caption, escapeXml, formatClock, formatDay, headerMeta, safeAccent } from './format.js';
import {
  CARD,
  PLOT_BOTTOM,
  PLOT_MIN_HEIGHT,
  buildPlot,
  buildVoidPanel,
  findDot,
  plotBox,
  type Dot,
  type PlotBox,
} from './layout.js';
import { LINE_HEIGHT, fitOneLine, measure, wrapHeadline, type Run } from './text.js';
import type { CardPayload } from './types.js';

// Camo will not fetch a webfont, so these resolve against the viewer's own fonts. A real
// Didone needs a base64-embedded subset — open item, not an accident.
const SERIF = "'Bodoni Moda',Didot,'Playfair Display',Georgia,serif";
const MONO = "'Space Mono','SFMono-Regular',Menlo,Consolas,monospace";
const SANS = "'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif";

const INK = '#f3f0e8';
/** The card's own background, used to knock out behind anchor labels. */
const BACKDROP = '#0b0d12';
const MUTED = '#b6b3aa';
const DIM = '#77756d';

/** The headline column is deliberately narrow. The frame is the hard limit. */
const HEADLINE_COLUMN = 720;
const HEADLINE_FRAME = CARD.width - 120;
const HEADLINE_TOP = 190;

/** Room above the scatter. The type shrinks into it; nothing Cortex writes can fail to fit. */
const HEADLINE_BUDGET = PLOT_BOTTOM - PLOT_MIN_HEIGHT - HEADLINE_TOP;

interface TextOptions {
  x: number;
  y: number;
  size: number;
  family: string;
  fill: string;
  weight?: number;
  spacing?: number;
  anchor?: 'start' | 'middle' | 'end';
  italic?: boolean;
  uppercase?: boolean;
  /** Knocks the scatter out from behind the glyphs so the label stays readable. */
  halo?: boolean;
}

function text(content: string, options: TextOptions): string {
  const attrs = [
    `x="${round(options.x)}"`,
    `y="${round(options.y)}"`,
    `font-family="${options.family}"`,
    `font-size="${options.size}"`,
    `fill="${options.fill}"`,
    options.weight ? `font-weight="${options.weight}"` : '',
    options.spacing ? `letter-spacing="${options.spacing}"` : '',
    options.anchor ? `text-anchor="${options.anchor}"` : '',
    options.italic ? 'font-style="italic"' : '',
    options.halo ? `stroke="${BACKDROP}" stroke-width="3.5" paint-order="stroke"` : '',
  ].filter(Boolean);

  const body = options.uppercase ? content.toUpperCase() : content;
  return `<text ${attrs.join(' ')}>${escapeXml(body)}</text>`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface Headline {
  svg: string;
  bottom: number;
}

function renderHeadline(payload: CardPayload, accent: string): Headline {
  const runs: Run[] = [
    { text: payload.headlineUpright, italic: false },
    { text: payload.headlineAccent, italic: true },
    { text: payload.headlineTrail, italic: false },
  ].filter((run) => run.text.trim().length > 0);

  const { lines, fontSize } = wrapHeadline(runs, {
    maxWidth: HEADLINE_COLUMN,
    hardMax: HEADLINE_FRAME,
    heightBudget: HEADLINE_BUDGET,
    sizes: [48, 44, 40, 36, 32, 28, 24],
  });
  const lineHeight = fontSize * LINE_HEIGHT;

  const svg = lines
    .map((line, index) => {
      const tspans = line.runs
        .map((run) =>
          run.italic
            ? `<tspan font-style="italic" fill="${accent}">${escapeXml(run.text)}</tspan>`
            : `<tspan>${escapeXml(run.text)}</tspan>`,
        )
        .join('');
      const y = HEADLINE_TOP + fontSize * 0.78 + index * lineHeight;
      return `<text x="60" y="${round(y)}" font-family="${SERIF}" font-size="${fontSize}" font-weight="500" fill="${INK}" letter-spacing="-0.8">${tspans}</text>`;
    })
    .join('');

  return { svg, bottom: HEADLINE_TOP + lines.length * lineHeight };
}

function renderDot(dot: Dot, accent: string): string {
  const cx = round(dot.x);
  const cy = round(dot.y);

  if (dot.last) {
    return [
      `<circle cx="${cx}" cy="${cy}" r="13" fill="${accent}" fill-opacity="0.18"/>`,
      `<circle cx="${cx}" cy="${cy}" r="7.5" fill="${accent}" stroke="${BACKDROP}" stroke-width="2"/>`,
    ].join('');
  }

  // The ring is the surface colour, not a border: where two commits land on the same hour
  // it keeps them countable instead of fusing them into one larger dot.
  return dot.night
    ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${INK}" fill-opacity="0.92" stroke="${BACKDROP}" stroke-width="2"/>`
    : `<circle cx="${cx}" cy="${cy}" r="4.5" fill="none" stroke="${INK}" stroke-opacity="0.5" stroke-width="1.5"/>`;
}

const ATTRIBUTION = 'Read by Snowflake Cortex';
const ATTRIBUTION_SIZE = 12;
const ATTRIBUTION_SPACING = 1;

function attributionWidth(): number {
  return (
    measure(ATTRIBUTION, ATTRIBUTION_SIZE, 'mono') + ATTRIBUTION_SPACING * (ATTRIBUTION.length - 1)
  );
}

/**
 * The signature beside the attribution: a six-spoke crystal with a glow behind it.
 *
 * The card says who read it once, in words. This says it again in a mark, which is what a
 * reader remembers and what survives being shrunk into a README.
 */
function crystal(cx: number, cy: number, accent: string): string {
  const r = 5;
  const spokes = [0, 60, 120]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const dx = round(Math.cos(rad) * r);
      const dy = round(Math.sin(rad) * r);
      return `<line x1="${cx - dx}" y1="${cy - dy}" x2="${cx + dx}" y2="${cy + dy}" stroke="${accent}" stroke-width="1.2" stroke-linecap="round"/>`;
    })
    .join('');

  return [
    `<circle cx="${cx}" cy="${cy}" r="9" fill="url(#glowMark)"/>`,
    spokes,
    `<circle cx="${cx}" cy="${cy}" r="1.7" fill="${accent}"/>`,
  ].join('');
}

/** Keep an anchor label inside the frame no matter which dot it is pinned to. */
function clampX(x: number, width: number, anchor: 'start' | 'end'): number {
  if (anchor === 'start') return Math.min(x, CARD.width - 60 - width);
  return Math.max(x, 60 + width);
}

/**
 * Render the 1200×630 card as an SVG string.
 *
 * Every value on it is a constant, a fact Snowflake computed, or a phrase Cortex wrote —
 * the renderer invents nothing.
 */
export function renderCard(payload: CardPayload): string {
  const accent = safeAccent(payload.accent);
  const facts = payload.facts;

  const headline = renderHeadline(payload, accent);
  // Plot starts below where the headline actually ended, so it cannot be landed on.
  const box: PlotBox = plotBox(headline.bottom);

  const geometry = buildPlot(payload.plot, box);
  const voidPanel = buildVoidPanel(facts.largestGap, geometry.startMs, geometry.endMs, box);

  const firstDot = findDot(geometry.dots, facts.firstCommitAt);
  const lastDot = findDot(geometry.dots, facts.lastCommitAt);
  const pivotDot = findDot(geometry.dots, payload.pivotAt);
  const handle = facts.primaryAuthorLogin ?? facts.primaryAuthor;

  const parts: string[] = [];

  parts.push(
    `<rect width="${CARD.width}" height="${CARD.height}" fill="url(#bg)"/>`,
    `<rect width="${CARD.width}" height="${CARD.height}" fill="url(#glow)"/>`,
    `<rect width="${CARD.width}" height="${CARD.height}" fill="url(#vignette)"/>`,
    `<rect width="${CARD.width}" height="5" fill="url(#rule)"/>`,
  );

  // Header: product mark, then the observed meta. No opinion in this row.
  parts.push(
    `<circle cx="73" cy="70" r="12" fill="none" stroke="${accent}" stroke-width="1.5"/>`,
    `<circle cx="73" cy="70" r="3.5" fill="${accent}"/>`,
    text('Commit Chronicles', {
      x: 96,
      y: 78,
      size: 22,
      family: SERIF,
      fill: INK,
      weight: 600,
    }),
    text(headerMeta(facts.commitCount, payload.statusLabel, facts.lastCommitAt), {
      x: CARD.width - 60,
      y: 76,
      size: 13,
      family: MONO,
      fill: '#9a988f',
      spacing: 2.3,
      anchor: 'end',
      uppercase: true,
    }),
  );

  // One line, no wrap: sets smaller rather than running off the edge.
  const kicker = `${payload.repo}  —  ${payload.kicker}`;
  const kickerSize = fitOneLine(kicker, 'mono', CARD.width - 120, [13, 12, 11, 10, 9], 2.6);

  parts.push(
    text(kicker, {
      x: 60,
      y: 150,
      size: kickerSize,
      family: MONO,
      fill: accent,
      spacing: 2.6,
      uppercase: true,
    }),
    headline.svg,
  );

  // Axes.
  parts.push(
    `<line x1="${box.x}" y1="${round(box.y)}" x2="${box.x}" y2="${round(box.y + box.height)}" stroke="${INK}" stroke-opacity="0.14"/>`,
    `<line x1="${box.x}" y1="${round(box.y + box.height)}" x2="${box.x + box.width}" y2="${round(box.y + box.height)}" stroke="${INK}" stroke-opacity="0.14"/>`,
  );

  for (const tick of geometry.yTicks) {
    parts.push(
      `<line x1="${box.x}" y1="${round(tick.y)}" x2="${box.x + box.width}" y2="${round(tick.y)}" stroke="${INK}" stroke-opacity="0.06"/>`,
      text(tick.label, {
        x: box.x - 12,
        y: tick.y + 3.5,
        size: 10,
        family: MONO,
        fill: DIM,
        spacing: 0.8,
        anchor: 'end',
        uppercase: true,
      }),
    );
  }

  for (const tick of geometry.xTicks) {
    parts.push(
      text(tick.label, {
        x: tick.x,
        y: box.y + box.height + 24,
        size: 10.5,
        family: MONO,
        fill: DIM,
        spacing: 1,
        anchor: 'middle',
        uppercase: true,
      }),
    );
  }

  // The void panel: a stretch you look straight through.
  if (voidPanel && facts.largestGap) {
    const mid = voidPanel.x + voidPanel.width / 2;
    parts.push(
      `<rect x="${round(voidPanel.x)}" y="${round(box.y)}" width="${round(voidPanel.width)}" height="${round(box.height)}" fill="#000000" fill-opacity="0.45"/>`,
      `<line x1="${round(voidPanel.x)}" y1="${round(box.y)}" x2="${round(voidPanel.x)}" y2="${round(box.y + box.height)}" stroke="${accent}" stroke-opacity="0.4"/>`,
      `<line x1="${round(voidPanel.x + voidPanel.width)}" y1="${round(box.y)}" x2="${round(voidPanel.x + voidPanel.width)}" y2="${round(box.y + box.height)}" stroke="${accent}" stroke-opacity="0.4"/>`,
      text(`${facts.largestGap.days} days dark`, {
        x: mid,
        y: box.y + 30,
        size: 20,
        family: SERIF,
        fill: '#cbc8bf',
        anchor: 'middle',
        italic: true,
        halo: true,
      }),
      text(`${formatDay(facts.largestGap.from)} — ${formatDay(facts.largestGap.to)}`, {
        x: mid,
        y: box.y + 48,
        size: 9.5,
        family: MONO,
        fill: DIM,
        spacing: 1,
        anchor: 'middle',
        uppercase: true,
      }),
    );
  }

  parts.push(...geometry.dots.map((dot) => renderDot(dot, accent)));

  // Only the anchors this storyline uses get a poetic tail. Labels sit clear of their dot.
  // Anchor labels ride a rail above the plot and reach their dot with a leader line, so no
  // label is ever printed into the scatter it is describing. Works the same whether the
  // commits sit at the top of the clock or the bottom.
  const railY = box.y - 9;

  const anchor = (
    dot: Dot | null,
    label: string,
    fill: string,
    align: 'start' | 'middle' | 'end',
  ): string => {
    if (!dot || !label) return '';

    const width = label.length * 6.2;

    return [
      `<line x1="${round(dot.x)}" y1="${round(railY + 4)}" x2="${round(dot.x)}" y2="${round(dot.y - 8)}" stroke="${fill}" stroke-opacity="0.35" stroke-width="1"/>`,
      text(label, {
        x: clampX(dot.x, width, align === 'end' ? 'end' : 'start'),
        y: railY,
        size: 10,
        family: MONO,
        fill,
        spacing: 0.4,
        anchor: align,
      }),
    ].join('');
  };

  const firstLabel = (() => {
    const tail = payload.labelFirst.trim();
    return `${formatClock(facts.firstCommitAt)} · ${formatDay(facts.firstCommitAt)}${tail ? ` — ${tail}` : ''}`;
  })();

  const lastLabel = payload.labelLast.trim()
    ? payload.labelLast.trim()
    : `last commit · ${formatClock(facts.lastCommitAt)}`;

  parts.push(anchor(firstDot, firstLabel, '#cbc8bf', 'start'));

  // The pivot only gets a rail slot when it is not about to sit on the last commit's.
  const pivotClear =
    pivotDot !== null &&
    payload.labelPivot.trim().length > 0 &&
    (lastDot === null || Math.abs(pivotDot.x - lastDot.x) > 150);

  if (pivotClear) {
    parts.push(anchor(pivotDot, payload.labelPivot.trim(), '#cbc8bf', 'middle'));
  }

  parts.push(anchor(lastDot, lastLabel, accent, 'end'));

  // Foot: the disclosure, the author, the attribution.
  parts.push(
    `<line x1="60" y1="551" x2="${CARD.width - 60}" y2="551" stroke="${INK}" stroke-opacity="0.14"/>`,
    text(caption(facts.lastCommitAt), {
      x: 60,
      y: 578,
      size: 15,
      family: SANS,
      fill: MUTED,
    }),
    text(`@${handle}`, {
      x: CARD.width - 60,
      y: 573,
      size: 13,
      family: MONO,
      fill: INK,
      anchor: 'end',
    }),
    // Right-anchored, so the mark is placed from measured width, not a fixed offset.
    crystal(round(CARD.width - 60 - attributionWidth() - 14), 591, accent),
    text('Read by Snowflake Cortex', {
      x: CARD.width - 60,
      y: 595,
      size: 12,
      family: MONO,
      fill: accent,
      weight: 700,
      spacing: 1,
      anchor: 'end',
      uppercase: true,
    }),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="${escapeXml(cardAltText(payload))}">`,
    '<defs>',
    '<radialGradient id="bg" cx="78%" cy="-10%" r="130%">',
    '<stop offset="0%" stop-color="#10141c"/><stop offset="44%" stop-color="#0e1116"/><stop offset="100%" stop-color="#0b0d12"/>',
    '</radialGradient>',
    '<radialGradient id="glow" cx="82%" cy="-8%" r="90%">',
    `<stop offset="0%" stop-color="${accent}" stop-opacity="0.13"/><stop offset="56%" stop-color="${accent}" stop-opacity="0"/>`,
    '</radialGradient>',
    `<radialGradient id="glowMark" cx="50%" cy="50%" r="50%">`,
    `<stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/>`,
    '</radialGradient>',
    '<radialGradient id="vignette" cx="50%" cy="40%" r="70%">',
    '<stop offset="58%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>',
    '</radialGradient>',
    '<linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">',
    `<stop offset="0%" stop-color="${accent}"/><stop offset="62%" stop-color="${accent}"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/>`,
    '</linearGradient>',
    '</defs>',
    ...parts,
    '</svg>',
  ].join('');
}

/**
 * The card's story as a sentence, for the SVG's `aria-label`.
 *
 * The card ships as an image in someone's README, and a screen reader still has to get it.
 */
export function cardAltText(payload: CardPayload): string {
  const headline = [payload.headlineUpright, payload.headlineAccent, payload.headlineTrail]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `Commit Chronicles card for ${payload.repo} — ${payload.kicker}. ${headline} ${caption(
    payload.facts.lastCommitAt,
  )}`;
}
