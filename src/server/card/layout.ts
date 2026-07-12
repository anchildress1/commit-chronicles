import { parseSnowflakeTimestamp } from './format.js';
import type { PlotPoint } from './types.js';

/** Card frame. 1200×630 is the README and social preview size; everything else derives. */
export const CARD = { width: 1200, height: 630 } as const;

export interface PlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// `y` is not a constant: the headline is model-written and its height varies, so the plot
// starts below wherever it actually ended.
export const PLOT_X = 140;
export const PLOT_WIDTH = 1000;
export const PLOT_BOTTOM = 508;
/** Below this the scatter is a smear, so the headline gives ground instead. */
export const PLOT_MIN_HEIGHT = 150;

/**
 * The scatter's box, starting below wherever the headline ended.
 *
 * @param headlineBottom Y coordinate the headline block ran to.
 * @returns A box clamped to {@link PLOT_MIN_HEIGHT}, always ending at {@link PLOT_BOTTOM}.
 */
export function plotBox(headlineBottom: number): PlotBox {
  const top = Math.min(headlineBottom + 26, PLOT_BOTTOM - PLOT_MIN_HEIGHT);
  return { x: PLOT_X, y: top, width: PLOT_WIDTH, height: PLOT_BOTTOM - top };
}

/** Rotated so 6am is the ceiling and the small hours are the floor: later must read as down. */
export function hourToY(hourFraction: number, box: PlotBox): number {
  const rotated = (((hourFraction - 6) % 24) + 24) % 24;
  return box.y + (0.06 + (rotated / 24) * 0.88) * box.height;
}

/**
 * Place an instant along the x-axis. A repo whose commits share one instant centres.
 */
export function timeToX(ms: number, startMs: number, endMs: number, box: PlotBox): number {
  const span = endMs - startMs;
  const fraction = span <= 0 ? 0.5 : (ms - startMs) / span;
  return box.x + (0.03 + fraction * 0.94) * box.width;
}

export interface Dot {
  x: number;
  y: number;
  night: boolean;
  /** The final commit gets the accent dot — it is the point of most of these stories. */
  last: boolean;
  t: string;
}

export interface PlotGeometry {
  dots: Dot[];
  startMs: number;
  endMs: number;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Lay out every commit, plus the axis ticks.
 *
 * Rows are sorted here, and `m` is honoured because the card annotates exact times rather
 * than whole hours.
 *
 * @param plot Snowflake's `PLOT` array, in any order.
 */
export function buildPlot(plot: PlotPoint[], box: PlotBox): PlotGeometry {
  const points = plot
    .map((p) => ({ ...p, ms: parseSnowflakeTimestamp(p.t).getTime() }))
    .sort((a, b) => a.ms - b.ms);

  const startMs = points[0]?.ms ?? 0;
  const endMs = points[points.length - 1]?.ms ?? startMs + 1;
  const lastIndex = points.length - 1;

  const dots = points.map((p, index) => ({
    x: timeToX(p.ms, startMs, endMs, box),
    y: hourToY(p.h + p.m / 60, box),
    night: p.n,
    last: index === lastIndex,
    t: p.t,
  }));

  return {
    dots,
    startMs,
    endMs,
    xTicks: monthTicks(startMs, endMs, box),
    yTicks: [
      { y: hourToY(18, box), label: '6 pm' },
      { y: hourToY(0, box), label: 'midnight' },
      { y: hourToY(3, box), label: '3 am' },
    ],
  };
}

/** One tick per month crossed, thinned so a long history does not fill the axis with stubs. */
function monthTicks(startMs: number, endMs: number, box: PlotBox): { x: number; label: string }[] {
  const start = new Date(startMs);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const boundaries: Date[] = [];

  while (cursor.getTime() <= endMs && boundaries.length < 400) {
    if (cursor.getTime() >= startMs) boundaries.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // A year only earns a place on the axis when the span is long enough that the month
  // alone is ambiguous. "JAN 26" on a three-month card reads as the 26th of January.
  const showYear = boundaries.length > 12;
  const stride = Math.ceil(boundaries.length / 6) || 1;

  const ticks = boundaries
    .filter((_, index) => index % stride === 0)
    .map((date) => ({
      x: timeToX(date.getTime(), startMs, endMs, box),
      label: showYear
        ? `${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear()).slice(2)}`
        : (MONTHS[date.getUTCMonth()] ?? ''),
    }));

  const end = new Date(endMs);
  ticks.push({
    x: timeToX(endMs, startMs, endMs, box),
    label: `${MONTHS[end.getUTCMonth()] ?? ''} ${end.getUTCDate()}`,
  });

  // The closing tick always wins; a month boundary sitting on top of it is noise.
  const closing = ticks[ticks.length - 1];
  if (!closing) return ticks;

  return ticks.filter((tick, index) => index === ticks.length - 1 || tick.x < closing.x - 60);
}

export interface VoidPanel {
  x: number;
  width: number;
}

/** Short silences are just gaps between dots. A void panel is a claim, so it has a floor. */
export const VOID_MIN_DAYS = 14;

/**
 * The panel drawn over the repo's longest silence.
 *
 * @param gap `FACTS.largestGap`, or null when the history has no gap at all.
 * @returns Null when the silence is shorter than {@link VOID_MIN_DAYS} or would render
 *   thinner than its own label.
 */
export function buildVoidPanel(
  gap: { days: number; from: string; to: string } | null,
  startMs: number,
  endMs: number,
  box: PlotBox,
): VoidPanel | null {
  if (!gap || gap.days < VOID_MIN_DAYS) return null;

  const fromX = timeToX(parseSnowflakeTimestamp(gap.from).getTime(), startMs, endMs, box);
  const toX = timeToX(parseSnowflakeTimestamp(gap.to).getTime(), startMs, endMs, box);
  const width = toX - fromX;

  // A panel thinner than its own label reads as a rendering bug, not a silence.
  if (width < 48) return null;

  return { x: fromX, width };
}

/**
 * Find the dot an anchor rides, by exact string match against `plot[].t`.
 *
 * @returns Null for a null anchor, and for a timestamp that matches no commit.
 */
export function findDot(dots: Dot[], timestamp: string | null): Dot | null {
  if (!timestamp) return null;
  return dots.find((dot) => dot.t === timestamp) ?? null;
}
