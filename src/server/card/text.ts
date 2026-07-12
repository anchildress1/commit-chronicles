// The card is a string, never measured in a browser, so wrapping needs an estimate.
// Average glyph advance in `em`, biased high: wrapping a word early beats overrunning.
const ADVANCE = {
  serif: 0.5,
  serifItalic: 0.46,
  mono: 0.6,
  sans: 0.52,
} as const;

export type Face = keyof typeof ADVANCE;

/**
 * Estimated rendered width of `text`, in pixels.
 *
 * @param face Selects the average glyph advance; the card is never measured in a browser.
 */
export function measure(text: string, fontSize: number, face: Face): number {
  return text.length * ADVANCE[face] * fontSize;
}

export interface Run {
  text: string;
  italic: boolean;
}

export interface LaidOutLine {
  runs: Run[];
}

export interface WrappedHeadline {
  lines: LaidOutLine[];
  fontSize: number;
}

interface Word {
  text: string;
  italic: boolean;
  /** False for the first word, and for punctuation welded to what it follows. */
  spaceBefore: boolean;
}

/** A run that opens with punctuation is the tail of the previous word, not a new one. */
const OPENS_WITH_PUNCTUATION = /^[.,;:!?)'’”]/;

function tokenize(runs: Run[]): Word[] {
  const words: Word[] = [];

  for (const run of runs) {
    const pieces = run.text.split(/\s+/).filter((piece) => piece.length > 0);

    pieces.forEach((piece, index) => {
      const firstOfRun = index === 0;
      const glued = firstOfRun && OPENS_WITH_PUNCTUATION.test(run.text.trimStart());
      words.push({
        text: piece,
        italic: run.italic,
        spaceBefore: words.length > 0 && !glued,
      });
    });
  }

  return words;
}

function wordWidth(word: Word, fontSize: number): number {
  const glyphs = measure(word.text, fontSize, word.italic ? 'serifItalic' : 'serif');
  return glyphs + (word.spaceBefore ? measure(' ', fontSize, 'serif') : 0);
}

function lineWidth(words: Word[], fontSize: number): number {
  return words.reduce(
    (total, word, index) =>
      total + wordWidth(index === 0 ? { ...word, spaceBefore: false } : word, fontSize),
    0,
  );
}

function wrapAt(words: Word[], fontSize: number, maxWidth: number): LaidOutLine[] {
  const lines: LaidOutLine[] = [];
  let current: Word[] = [];

  for (const word of words) {
    const next = [...current, word];
    if (current.length > 0 && lineWidth(next, fontSize) > maxWidth) {
      lines.push({ runs: mergeRuns(current) });
      current = [word];
    } else {
      current = next;
    }
  }

  if (current.length > 0) lines.push({ runs: mergeRuns(current) });
  return lines;
}

/** Adjacent words in the same style become one tspan; the italic run must not be sliced. */
function mergeRuns(words: Word[]): Run[] {
  const runs: Run[] = [];

  for (const [index, word] of words.entries()) {
    const previous = runs[runs.length - 1];
    const spaced = index > 0 && word.spaceBefore ? ` ${word.text}` : word.text;

    if (previous && previous.italic === word.italic) {
      previous.text += spaced;
    } else {
      runs.push({ text: spaced, italic: word.italic });
    }
  }

  return runs;
}

export interface WrapOptions {
  /** The column the headline is composed into — narrow on purpose. */
  maxWidth: number;
  /** Hard ceiling. A word may exceed the column; nothing may leave the card. */
  hardMax: number;
  /** Room above the scatter. */
  heightBudget: number;
  sizes?: readonly number[];
}

export const LINE_HEIGHT = 1.06;

function widest(lines: LaidOutLine[], fontSize: number): number {
  return lines.reduce((max, line) => {
    const width = line.runs.reduce(
      (total, run) => total + measure(run.text, fontSize, run.italic ? 'serifItalic' : 'serif'),
      0,
    );
    return Math.max(max, width);
  }, 0);
}

/**
 * Fit the headline to a height budget: the largest size whose wrapped block fits.
 *
 * Constrained decoding takes no `maxLength`, so Cortex cannot be held to a character count.
 * The frame absorbs whatever it writes — longer prose sets smaller and runs to more lines.
 * Never truncates: a half-printed sentence reads as the story the card meant to tell.
 */
export function wrapHeadline(
  runs: Run[],
  { maxWidth, hardMax, heightBudget, sizes = [52, 46, 40, 34, 30, 26, 22, 18] }: WrapOptions,
): WrappedHeadline {
  const words = tokenize(runs);

  const fits = (lines: LaidOutLine[], fontSize: number): boolean =>
    lines.length * fontSize * LINE_HEIGHT <= heightBudget && widest(lines, fontSize) <= hardMax;

  for (const fontSize of sizes) {
    const lines = wrapAt(words, fontSize, maxWidth);
    if (fits(lines, fontSize)) {
      return { lines, fontSize };
    }
  }

  // Over budget even at the smallest size: print it all anyway rather than truncate.
  const fontSize = sizes[sizes.length - 1] ?? 18;
  return { lines: wrapAt(words, fontSize, maxWidth), fontSize };
}

/**
 * Largest size from `sizes` at which `text` fits `maxWidth` on one line.
 *
 * Falls back to the smallest size rather than truncating, so nothing is ever cut.
 *
 * @param sizes Candidate font sizes, largest first.
 * @param letterSpacing Extra tracking per gap, added to the measured width.
 * @returns A font size in pixels.
 */
export function fitOneLine(
  text: string,
  face: Face,
  maxWidth: number,
  sizes: readonly number[],
  letterSpacing = 0,
): number {
  const width = (size: number): number =>
    measure(text, size, face) + letterSpacing * Math.max(0, text.length - 1);

  return sizes.find((size) => width(size) <= maxWidth) ?? sizes[sizes.length - 1] ?? 10;
}
