import type { RepoStatus } from './types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse Snowflake's `TIMESTAMP_TZ` rendering, which `Date` will not accept as-is.
 *
 * @throws {Error} When the value is not a timestamp in any recognised form.
 */
export function parseSnowflakeTimestamp(value: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/.exec(
      value.trim(),
    );

  if (!match) {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) {
      throw new TypeError(`unparseable Snowflake timestamp: ${value}`);
    }
    return fallback;
  }

  const [, date, time, offsetHours, offsetMinutes = '00'] = match;
  return new Date(`${date}T${time}${offsetHours}:${offsetMinutes}`);
}

/** Read against the timestamp's own offset: the server's zone would move the 3:53am ending. */
function fieldsInOriginalZone(value: string): {
  hour: number;
  minute: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) {
    const date = parseSnowflakeTimestamp(value);
    return {
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
  return {
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

/**
 * The commit's time as `3:53 AM`, read against its own UTC offset.
 *
 * The exact minute is the point, and the server's local zone must never move it.
 */
export function formatClock(value: string): string {
  const { hour, minute } = fieldsInOriginalZone(value);
  const meridiem = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/** `Feb 25` */
export function formatDay(value: string): string {
  const { month, day } = fieldsInOriginalZone(value);
  return `${MONTHS[month - 1] ?? ''} ${day}`.trim();
}

const STATUS_VERB: Record<RepoStatus, string> = {
  abandoned: 'abandoned since',
  dormant: 'quiet since',
  active: 'last touched',
};

/**
 * The header meta line, e.g. `59 commits · quiet since Feb 25`.
 *
 * Composed from facts alone — Cortex has no say in it.
 */
export function headerMeta(
  commitCount: number,
  status: RepoStatus,
  lastCommitAt: string,
  windowed = false,
): string {
  const plural = commitCount === 1 ? 'commit' : 'commits';
  // A windowed card counts the slice it was drawn from, so it says which slice. Without this
  // the number reads as the repo's whole life, and for a big repo that is simply false.
  const count = windowed
    ? `last ${String(commitCount)} ${plural}`
    : `${String(commitCount)} ${plural}`;
  return `${count} · ${STATUS_VERB[status]} ${formatDay(lastCommitAt)}`;
}

/** The fixed disclosure. The renderer owns this sentence, not Cortex. */
export function caption(lastCommitAt: string): string {
  return `Every dot is one commit, placed by the hour it landed. The last one was ${formatClock(
    lastCommitAt,
  )}, ${formatDay(lastCommitAt)}.`;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Cortex's accent, or `fallback` when it is not a `#rrggbb` colour.
 *
 * The card is public and the hex reaches the SVG, so it is verified even though the
 * response schema already constrains it.
 */
export function safeAccent(accent: string, fallback = '#6b7280'): string {
  return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : fallback;
}
