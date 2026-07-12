import { describe, expect, it } from 'vitest';
import {
  PLOT_BOTTOM,
  PLOT_MIN_HEIGHT,
  buildPlot,
  buildVoidPanel,
  findDot,
  hourToY,
  plotBox,
  timeToX,
} from '../../src/server/card/layout.js';
import type { PlotPoint } from '../../src/server/card/types.js';
import { DESCENT_PLOT, ts } from '../fixtures/card.js';

/** A two-line headline, the common case. */
const BOX = plotBox(300);

describe('plotBox', () => {
  it('starts below the headline, so a tall headline cannot land on the scatter', () => {
    expect(plotBox(300).y).toBeGreaterThan(300);
  });

  it('gives a short headline a taller plot', () => {
    expect(plotBox(240).height).toBeGreaterThan(plotBox(330).height);
  });

  it('refuses to squash the scatter below a readable height', () => {
    const box = plotBox(600);
    expect(box.height).toBe(PLOT_MIN_HEIGHT);
    expect(box.y + box.height).toBe(PLOT_BOTTOM);
  });

  it('always ends on the same baseline, whatever the headline did', () => {
    for (const bottom of [200, 260, 300, 360, 500]) {
      const box = plotBox(bottom);
      expect(box.y + box.height).toBe(PLOT_BOTTOM);
    }
  });
});

describe('hourToY', () => {
  it('puts 6am at the top of the frame', () => {
    expect(hourToY(6, BOX)).toBeLessThan(hourToY(12, BOX));
  });

  it('drops the small hours to the floor — the descent has to read as a descent', () => {
    expect(hourToY(3, BOX)).toBeGreaterThan(hourToY(18, BOX));
    expect(hourToY(3, BOX)).toBeGreaterThan(hourToY(0, BOX));
  });

  it('stays inside the plot box for every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(hourToY(hour, BOX)).toBeGreaterThanOrEqual(BOX.y);
      expect(hourToY(hour, BOX)).toBeLessThanOrEqual(BOX.y + BOX.height);
    }
  });

  it('wraps hour 24 back onto hour 0', () => {
    expect(hourToY(24, BOX)).toBeCloseTo(hourToY(0, BOX), 6);
  });
});

describe('timeToX', () => {
  it('places the first commit left of the last', () => {
    expect(timeToX(0, 0, 100, BOX)).toBeLessThan(timeToX(100, 0, 100, BOX));
  });

  it('centres a repo whose commits all landed at the same instant', () => {
    expect(timeToX(50, 50, 50, BOX)).toBeCloseTo(BOX.x + 0.5 * BOX.width, 6);
  });
});

describe('buildPlot', () => {
  it('places one dot per commit', () => {
    expect(buildPlot(DESCENT_PLOT, BOX).dots).toHaveLength(DESCENT_PLOT.length);
  });

  it('marks exactly one dot as the last', () => {
    expect(buildPlot(DESCENT_PLOT, BOX).dots.filter((dot) => dot.last)).toHaveLength(1);
  });

  it('sorts out-of-order plot rows before drawing them', () => {
    const dots = buildPlot([...DESCENT_PLOT].reverse(), BOX).dots;

    expect(dots.map((dot) => dot.x)).toEqual([...dots.map((dot) => dot.x)].sort((a, b) => a - b));
    expect(dots[dots.length - 1]?.t).toBe(ts('2026-02-25T03:53:00'));
  });

  it('carries Snowflake’s night flag through untouched', () => {
    const night = buildPlot(DESCENT_PLOT, BOX).dots.filter((dot) => dot.night);
    expect(night).toHaveLength(DESCENT_PLOT.filter((point) => point.n).length);
  });

  it('emits a closing x tick naming the last day', () => {
    const { xTicks } = buildPlot(DESCENT_PLOT, BOX);
    expect(xTicks[xTicks.length - 1]?.label).toBe('Feb 25');
  });

  it('does not stamp a year on a short span — "Jan 26" would read as a date', () => {
    const { xTicks } = buildPlot(DESCENT_PLOT, BOX);
    const months = xTicks.slice(0, -1).map((tick) => tick.label);
    expect(months.every((label) => !/\d/.test(label))).toBe(true);
  });

  it('survives a single-commit repo', () => {
    const { dots } = buildPlot(DESCENT_PLOT.slice(0, 1), BOX);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.last).toBe(true);
  });

  it('survives an empty plot', () => {
    expect(buildPlot([], BOX).dots).toEqual([]);
  });
});

describe('the beeswarm', () => {
  /** Four commits in one night, at nearly the same hour: the worst overplotting case. */
  const CLUSTER: PlotPoint[] = [
    { t: ts('2026-01-05T02:00:00'), d: '2026-01-05', h: 2, m: 0, n: true },
    { t: ts('2026-01-05T02:05:00'), d: '2026-01-05', h: 2, m: 5, n: true },
    { t: ts('2026-01-05T02:10:00'), d: '2026-01-05', h: 2, m: 10, n: true },
    { t: ts('2026-01-05T02:15:00'), d: '2026-01-05', h: 2, m: 15, n: true },
    { t: ts('2026-02-20T02:00:00'), d: '2026-02-20', h: 2, m: 0, n: true },
  ];

  it('draws four commits in one night as four dots, not one', () => {
    const { dots } = buildPlot(CLUSTER, BOX);
    const night = dots.slice(0, 4);

    for (let i = 0; i < night.length; i += 1) {
      for (let j = i + 1; j < night.length; j += 1) {
        const a = night[i]!;
        const b = night[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(8.9);
      }
    }
  });

  it('never moves the hour — only the day slides', () => {
    const swarmed = buildPlot(CLUSTER, BOX).dots;
    const unswarmed = CLUSTER.map((p) => hourToY(p.h + p.m / 60, BOX)).sort((a, b) => a - b);

    expect(swarmed.map((dot) => dot.y).sort((a, b) => a - b)).toEqual(unswarmed);
  });

  it('keeps the slide inside the cluster, not across the axis', () => {
    const { dots, startMs, endMs } = buildPlot(CLUSTER, BOX);

    for (const [index, dot] of dots.entries()) {
      const trueX = timeToX(
        new Date(CLUSTER[index]!.t.replace(' ', 'T').slice(0, 19)).getTime(),
        startMs,
        endMs,
        BOX,
      );
      expect(Math.abs(dot.x - trueX)).toBeLessThanOrEqual(28);
    }
  });

  it('draws the same card twice for the same history', () => {
    const a = buildPlot(CLUSTER, BOX).dots.map((dot) => [dot.x, dot.y]);
    const b = buildPlot([...CLUSTER].reverse(), BOX).dots.map((dot) => [dot.x, dot.y]);

    expect(a).toEqual(b);
  });

  it('hides no commit, however crowded the night', () => {
    const crowded: PlotPoint[] = Array.from({ length: 30 }, (_, i) => ({
      t: ts(`2026-01-05T02:${String(i % 60).padStart(2, '0')}:00`),
      d: '2026-01-05',
      h: 2,
      m: i % 60,
      n: true,
    }));

    expect(buildPlot(crowded, BOX).dots).toHaveLength(30);
  });
});

describe('buildVoidPanel', () => {
  const { startMs, endMs } = buildPlot(DESCENT_PLOT, BOX);

  it('draws the panel for a long silence', () => {
    const panel = buildVoidPanel(
      { days: 38, from: ts('2025-12-27T01:05:00'), to: ts('2026-02-03T01:58:00') },
      startMs,
      endMs,
      BOX,
    );

    expect(panel).not.toBeNull();
    expect(panel!.width).toBeGreaterThan(48);
  });

  it('says nothing when there is no gap at all', () => {
    expect(buildVoidPanel(null, startMs, endMs, BOX)).toBeNull();
  });

  it('refuses to call a short quiet stretch a void', () => {
    expect(
      buildVoidPanel(
        { days: 6, from: ts('2025-12-27T01:05:00'), to: ts('2026-01-02T01:58:00') },
        startMs,
        endMs,
        BOX,
      ),
    ).toBeNull();
  });

  it('refuses a panel too thin to hold its own label', () => {
    // 20 days clears the floor, but on a decade-long span it is a hairline.
    const wideEnd = endMs + 1000 * 60 * 60 * 24 * 3650;
    expect(
      buildVoidPanel(
        { days: 20, from: ts('2025-12-27T01:05:00'), to: ts('2026-01-16T01:58:00') },
        startMs,
        wideEnd,
        BOX,
      ),
    ).toBeNull();
  });
});

describe('findDot', () => {
  const { dots } = buildPlot(DESCENT_PLOT, BOX);

  it('pins an anchor by exact timestamp match', () => {
    expect(findDot(dots, ts('2026-02-25T03:53:00'))?.last).toBe(true);
  });

  it('returns null for a null anchor', () => {
    expect(findDot(dots, null)).toBeNull();
  });

  it('returns null when the timestamp matches no commit', () => {
    expect(findDot(dots, ts('1999-01-01T00:00:00'))).toBeNull();
  });
});
