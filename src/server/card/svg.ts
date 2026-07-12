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
const MUTED = '#b6b3aa';
const DIM = '#77756d';

/** The headline column is deliberately narrow. The frame is the hard limit. */
const HEADLINE_COLUMN = 620;
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
  if (dot.last) {
    return [
      `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="12" fill="${accent}" fill-opacity="0.22"/>`,
      `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="7" fill="${accent}"/>`,
    ].join('');
  }

  // Hollow by day, solid by night: the descent has to read before the words do.
  return dot.night
    ? `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="4.5" fill="${INK}" opacity="0.92"/>`
    : `<circle cx="${round(dot.x)}" cy="${round(dot.y)}" r="4" fill="none" stroke="${INK}" stroke-opacity="0.42" stroke-width="1.5"/>`;
}

const ATTRIBUTION = 'Read by Snowflake Cortex';
const ATTRIBUTION_SIZE = 12;
const ATTRIBUTION_SPACING = 1;

function attributionWidth(): number {
  return (
    measure(ATTRIBUTION, ATTRIBUTION_SIZE, 'mono') + ATTRIBUTION_SPACING * (ATTRIBUTION.length - 1)
  );
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
      `<rect x="${round(voidPanel.x)}" y="${round(box.y)}" width="${round(voidPanel.width)}" height="${round(box.height)}" fill="#000000" fill-opacity="0.28"/>`,
      `<line x1="${round(voidPanel.x)}" y1="${round(box.y)}" x2="${round(voidPanel.x)}" y2="${round(box.y + box.height)}" stroke="${accent}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`,
      `<line x1="${round(voidPanel.x + voidPanel.width)}" y1="${round(box.y)}" x2="${round(voidPanel.x + voidPanel.width)}" y2="${round(box.y + box.height)}" stroke="${accent}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`,
      text(`${facts.largestGap.days} days dark`, {
        x: mid,
        y: box.y + 30,
        size: 20,
        family: SERIF,
        fill: '#cbc8bf',
        anchor: 'middle',
        italic: true,
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
  if (firstDot) {
    const tail = payload.labelFirst.trim();
    const label = `${formatClock(facts.firstCommitAt)} · ${formatDay(facts.firstCommitAt)}${tail ? ` — ${tail}` : ''}`;
    parts.push(
      text(label, {
        x: clampX(firstDot.x + 12, label.length * 6, 'start'),
        y: Math.max(firstDot.y - 16, box.y + 12),
        size: 10,
        family: MONO,
        fill: '#cbc8bf',
        spacing: 0.4,
      }),
    );
  }

  if (pivotDot && payload.labelPivot.trim()) {
    const label = payload.labelPivot.trim();
    parts.push(
      text(label, {
        x: pivotDot.x,
        y: Math.max(pivotDot.y - 18, box.y + 12),
        size: 10,
        family: MONO,
        fill: '#cbc8bf',
        spacing: 0.4,
        anchor: 'middle',
      }),
    );
  }

  if (lastDot) {
    const tail = payload.labelLast.trim();
    const label = tail ? `${tail} ↓` : `last commit · ${formatClock(facts.lastCommitAt)} ↓`;
    parts.push(
      text(label, {
        x: clampX(lastDot.x + 10, label.length * 6, 'end'),
        y: Math.max(lastDot.y - 18, box.y + 12),
        size: 10,
        family: MONO,
        fill: accent,
        spacing: 0.4,
        anchor: 'end',
      }),
    );
  }

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
    // Right-anchored, so the bullet is placed from measured width, not a fixed offset.
    `<circle cx="${round(CARD.width - 60 - attributionWidth() - 10)}" cy="591" r="3" fill="${accent}"/>`,
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
