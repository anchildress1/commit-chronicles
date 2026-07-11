/**
 * Text metrics for SVG layout.
 *
 * The card is rendered as a string, not measured in a browser, so line breaking needs an
 * estimate of how wide a run will be. These factors are average glyph advance in `em`,
 * sampled from the three families the card actually uses. They are deliberately a little
 * generous: a headline that wraps one word early is fine, one that overruns the frame
 * is not.
 */
const ADVANCE = {
  serif: 0.5,
  serifItalic: 0.46,
  mono: 0.6,
  sans: 0.52,
} as const;

export type Face = keyof typeof ADVANCE;

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
  /** False for the first word, and for punctuation that must stay welded to what it follows. */
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
  /** The widest a line may ever be. A word longer than the column may exceed the column,
   *  but a word that leaves the card is a rendering bug. */
  hardMax: number;
  maxLines?: number;
  sizes?: readonly number[];
}

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
 * Wrap the three-slot headline, shrinking the type rather than letting it collide with the
 * scatter or run off the card.
 *
 * A single unbroken token can be wider than the column — a 55-character `headline_accent`
 * with no spaces is inside what Cortex is allowed to return — so line count alone is not
 * enough to prove the headline fits. The smallest size is chosen so the longest legal
 * token still lands inside the frame.
 */
export function wrapHeadline(
  runs: Run[],
  { maxWidth, hardMax, maxLines = 3, sizes = [52, 46, 40, 34, 28] }: WrapOptions,
): WrappedHeadline {
  const words = tokenize(runs);

  for (const fontSize of sizes) {
    const lines = wrapAt(words, fontSize, maxWidth);
    if (lines.length <= maxLines && widest(lines, fontSize) <= hardMax) {
      return { lines, fontSize };
    }
  }

  const fontSize = sizes[sizes.length - 1] ?? 28;
  return { lines: wrapAt(words, fontSize, maxWidth).slice(0, maxLines), fontSize };
}
