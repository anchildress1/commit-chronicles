import { describe, expect, it } from 'vitest';
import {
  caption,
  escapeXml,
  formatClock,
  formatDay,
  headerMeta,
  parseSnowflakeTimestamp,
  safeAccent,
} from '../../src/server/card/format.js';

describe('parseSnowflakeTimestamp', () => {
  it('parses the TIMESTAMP_TZ format the driver returns', () => {
    const parsed = parseSnowflakeTimestamp('2026-02-25 03:53:12.000 -0800');
    expect(parsed.toISOString()).toBe('2026-02-25T11:53:12.000Z');
  });

  it('parses an offset that already has a colon', () => {
    expect(parseSnowflakeTimestamp('2026-02-25 03:53:12 -08:00').toISOString()).toBe(
      '2026-02-25T11:53:12.000Z',
    );
  });

  it('parses a plain ISO string', () => {
    expect(parseSnowflakeTimestamp('2026-02-25T03:53:12+00:00').toISOString()).toBe(
      '2026-02-25T03:53:12.000Z',
    );
  });

  it('throws rather than returning an Invalid Date', () => {
    expect(() => parseSnowflakeTimestamp('not a timestamp')).toThrow(/unparseable/);
  });
});

describe('formatClock', () => {
  it.each([
    ['2026-02-25 03:53:00.000 -0500', '3:53 AM'],
    ['2026-02-25 00:07:00.000 -0500', '12:07 AM'],
    ['2026-02-25 12:00:00.000 -0500', '12:00 PM'],
    ['2026-02-25 23:59:00.000 -0500', '11:59 PM'],
  ])('renders %s as %s', (input, expected) => {
    expect(formatClock(input)).toBe(expected);
  });

  it('reads the clock in the commit’s own zone, not the server’s', () => {
    // Same instant, two offsets. The card must quote what the author's clock said.
    expect(formatClock('2026-02-25 03:53:00.000 -0800')).toBe('3:53 AM');
    expect(formatClock('2026-02-25 03:53:00.000 +0900')).toBe('3:53 AM');
  });
});

describe('formatDay', () => {
  it('renders a short month and day', () => {
    expect(formatDay('2026-02-25 03:53:00.000 -0500')).toBe('Feb 25');
  });

  it('handles January without falling off the month table', () => {
    expect(formatDay('2026-01-01 00:00:00.000 -0500')).toBe('Jan 1');
  });
});

describe('headerMeta', () => {
  it.each([
    ['abandoned', '59 commits · abandoned since Feb 25'],
    ['dormant', '59 commits · quiet since Feb 25'],
    ['active', '59 commits · last touched Feb 25'],
  ] as const)('maps %s to its verb', (status, expected) => {
    expect(headerMeta(59, status, '2026-02-25 03:53:00.000 -0500')).toBe(expected);
  });

  it('says commit, singular, for a repo with one', () => {
    expect(headerMeta(1, 'active', '2026-02-25 03:53:00.000 -0500')).toMatch(/^1 commit ·/);
  });
});

describe('caption', () => {
  it('states the disclosure and the one fact it needs', () => {
    expect(caption('2026-02-25 03:53:00.000 -0500')).toBe(
      'Every dot is one commit, placed by the hour it landed. The last one was 3:53 AM, Feb 25.',
    );
  });
});

describe('escapeXml', () => {
  it('escapes every character that could close a tag', () => {
    expect(escapeXml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&apos;');
  });

  it('leaves ordinary prose alone', () => {
    expect(escapeXml('the death of a side project')).toBe('the death of a side project');
  });
});

describe('safeAccent', () => {
  it('accepts a six-digit hex', () => {
    expect(safeAccent('#E8A04A')).toBe('#e8a04a');
  });

  it.each(['red', '#fff', '#e8a04', 'e8a04a', '#e8a04az', ''])(
    'falls back to grey for %s',
    (bad) => {
      expect(safeAccent(bad)).toBe('#6b7280');
    },
  );
});
