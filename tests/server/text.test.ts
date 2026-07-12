import { describe, expect, it } from 'vitest';
import { measure, wrapHeadline, type LaidOutLine, type Run } from '../../src/server/card/text.js';

/** The card's real column and frame. */
const COLUMN = { maxWidth: 660, hardMax: 1080 };

const lineText = (line: LaidOutLine): string => line.runs.map((run) => run.text).join('');
const flatten = (lines: LaidOutLine[]): string => lines.map(lineText).join(' ');

const widestLine = (lines: LaidOutLine[], fontSize: number): number =>
  Math.max(
    ...lines.map((line) =>
      line.runs.reduce(
        (total, run) => total + measure(run.text, fontSize, run.italic ? 'serifItalic' : 'serif'),
        0,
      ),
    ),
  );

describe('measure', () => {
  it('grows with length and size', () => {
    expect(measure('aaaa', 52, 'serif')).toBeGreaterThan(measure('aa', 52, 'serif'));
    expect(measure('aa', 52, 'serif')).toBeGreaterThan(measure('aa', 26, 'serif'));
  });

  it('treats italic serif as narrower than upright', () => {
    expect(measure('aaaa', 52, 'serifItalic')).toBeLessThan(measure('aaaa', 52, 'serif'));
  });

  it('is zero for an empty string', () => {
    expect(measure('', 52, 'serif')).toBe(0);
  });
});

describe('wrapHeadline', () => {
  const runs: Run[] = [
    { text: 'Born in daylight. Last touched at', italic: false },
    { text: '3:53 in the morning', italic: true },
    { text: '.', italic: false },
  ];

  it('keeps the real headline at the top size and inside three lines', () => {
    const wrapped = wrapHeadline(runs, COLUMN);
    expect(wrapped.fontSize).toBe(52);
    expect(wrapped.lines.length).toBeLessThanOrEqual(3);
  });

  it('preserves every word, in order', () => {
    expect(flatten(wrapHeadline(runs, COLUMN).lines)).toBe(
      'Born in daylight. Last touched at 3:53 in the morning.',
    );
  });

  it('welds the trailing period to the last word instead of floating it', () => {
    // `headline_trail` is its own slot, but "morning ." is not a sentence.
    const text = flatten(wrapHeadline(runs, COLUMN).lines);
    expect(text).toContain('morning.');
    expect(text).not.toContain('morning .');
  });

  it.each([',', ';', '!', '?', '’'])('welds a trailing %s too', (mark) => {
    const punctuated: Run[] = [
      { text: 'It ended', italic: false },
      { text: 'at 3:53', italic: true },
      { text: mark, italic: false },
    ];
    expect(flatten(wrapHeadline(punctuated, COLUMN).lines)).toBe(`It ended at 3:53${mark}`);
  });

  it('still spaces a trail that is a real word, not punctuation', () => {
    const trailing: Run[] = [
      { text: 'It ended', italic: false },
      { text: 'at 3:53', italic: true },
      { text: 'in the morning', italic: false },
    ];
    expect(flatten(wrapHeadline(trailing, COLUMN).lines)).toBe('It ended at 3:53 in the morning');
  });

  it('keeps the whole italic fragment marked as italic', () => {
    const italic = wrapHeadline(runs, COLUMN)
      .lines.map((line) =>
        line.runs
          .filter((run) => run.italic)
          .map((run) => run.text)
          .join(''),
      )
      .filter((text) => text.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    expect(italic).toBe('3:53 in the morning');
  });

  it('never splits a word across the upright and italic runs', () => {
    for (const line of wrapHeadline(runs, COLUMN).lines) {
      for (const run of line.runs) {
        expect(run.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('shrinks the type when a headline at the top size would not fit in three lines', () => {
    const long: Run[] = [
      {
        text: 'Every word of this headline is here to force a wrap and then another',
        italic: false,
      },
      { text: 'and one more clause to push it over the three-line budget entirely', italic: true },
    ];
    const wrapped = wrapHeadline(long, COLUMN);

    expect(wrapped.fontSize).toBeLessThan(52);
    expect(wrapped.lines.length).toBeLessThanOrEqual(3);
  });

  it('shrinks an unbreakable token until it fits inside the frame', () => {
    // Cortex may legally return a 55-character `headline_accent` with no spaces in it.
    // Wrapping cannot help; only the type size can.
    const unbreakable: Run[] = [
      { text: 'A'.repeat(45), italic: false },
      { text: 'B'.repeat(55), italic: true },
    ];
    const wrapped = wrapHeadline(unbreakable, COLUMN);

    expect(wrapped.fontSize).toBeLessThan(52);
    expect(widestLine(wrapped.lines, wrapped.fontSize)).toBeLessThanOrEqual(COLUMN.hardMax);
  });

  it('wraps every legal headline without dropping a word', () => {
    // The caps READ_REPO enforces: upright 60 + accent 60 + trail 5. If the renderer cannot
    // hold what the guard lets through, a card prints half a sentence and looks deliberate.
    const word = (n: number): string => {
      const out: string[] = [];
      while (out.join(' ').length < n) out.push('abcde');
      return out.join(' ').slice(0, n).trim();
    };

    const runs: Run[] = [
      { text: word(60), italic: false },
      { text: word(60), italic: true },
      { text: '.', italic: false },
    ];

    const wrapped = wrapHeadline(runs, COLUMN);
    const rendered = wrapped.lines.map(lineText).join(' ');

    const expected = `${word(60)} ${word(60)}`.split(/\s+/).filter(Boolean);
    const actual = rendered.replace(/\./g, '').split(/\s+/).filter(Boolean);

    expect(actual).toEqual(expected);
    expect(wrapped.lines.length).toBeLessThanOrEqual(3);
  });

  it('never emits more lines than the cap, even at the smallest size', () => {
    const absurd: Run[] = [{ text: 'word '.repeat(200), italic: false }];
    expect(wrapHeadline(absurd, COLUMN).lines.length).toBe(3);
  });

  it('puts a single short headline on one line', () => {
    expect(wrapHeadline([{ text: 'It stopped.', italic: false }], COLUMN).lines).toHaveLength(1);
  });

  it('returns no lines for empty runs', () => {
    expect(wrapHeadline([{ text: '', italic: false }], COLUMN).lines).toHaveLength(0);
  });

  it('breaks onto a new line when a word will not fit the column', () => {
    const wrapped = wrapHeadline([{ text: `${'x'.repeat(30)} tail`, italic: false }], COLUMN);
    expect(wrapped.lines.length).toBeGreaterThan(1);
  });
});
