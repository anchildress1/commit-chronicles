import type { RepoStatus } from './types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Date` cannot parse Snowflake's TIMESTAMP_TZ, so rebuild it into ISO-8601 rather than hope. */
export function parseSnowflakeTimestamp(value: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/.exec(
      value.trim(),
    );

  if (!match) {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) {
      throw new Error(`unparseable Snowflake timestamp: ${value}`);
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

/** `3:53 AM`. The exact minute is the point. */
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

/** `59 commits · quiet since Feb 25` — the header meta line. Facts only. */
export function headerMeta(commitCount: number, status: RepoStatus, lastCommitAt: string): string {
  const plural = commitCount === 1 ? 'commit' : 'commits';
  return `${commitCount} ${plural} · ${STATUS_VERB[status]} ${formatDay(lastCommitAt)}`;
}

/** The fixed disclosure. The renderer owns this sentence, not Cortex. */
export function caption(lastCommitAt: string): string {
  return `Every dot is one commit, placed by the hour it landed. The last one was ${formatClock(
    lastCommitAt,
  )}, ${formatDay(lastCommitAt)}.`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The card is public; verify the hex even though the schema constrains it. */
export function safeAccent(accent: string, fallback = '#6b7280'): string {
  return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent.toLowerCase() : fallback;
}
