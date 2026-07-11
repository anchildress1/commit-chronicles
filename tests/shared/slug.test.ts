import { describe, expect, it } from 'vitest';
import { InvalidSlugError, isValidSlug, parseSlug } from '../../src/shared/slug.js';

describe('parseSlug', () => {
  it('accepts a bare owner/repo', () => {
    expect(parseSlug('anchildress1/rai-lint')).toEqual({
      owner: 'anchildress1',
      repo: 'rai-lint',
      slug: 'anchildress1/rai-lint',
    });
  });

  it.each([
    ['https://github.com/torvalds/linux', 'torvalds/linux'],
    ['http://www.github.com/torvalds/linux/', 'torvalds/linux'],
    ['github.com/torvalds/linux.git', 'torvalds/linux'],
    ['  torvalds/linux  ', 'torvalds/linux'],
    ['git+https://github.com/torvalds/linux', 'torvalds/linux'],
  ])('normalizes %s', (input, expected) => {
    expect(parseSlug(input).slug).toBe(expected);
  });

  it('lowercases so one repo is one cache key', () => {
    expect(parseSlug('Torvalds/Linux').slug).toBe('torvalds/linux');
  });

  it('keeps dots and underscores that GitHub allows in a repo name', () => {
    expect(parseSlug('owner/my_repo.v2').repo).toBe('my_repo.v2');
  });

  it.each([
    ['', 'empty'],
    ['torvalds', 'no slash'],
    ['torvalds/linux/extra', 'too many segments'],
    ['/linux', 'no owner'],
    ['torvalds/', 'no repo'],
    ['-bad/repo', 'owner cannot start with a hyphen'],
    ['owner/repo?x=1', 'query string'],
    ['owner/repo name', 'whitespace inside'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseSlug(input)).toThrow(InvalidSlugError);
  });

  it.each([['../../etc/passwd'], ['owner/../../../secrets'], ['owner/..'], ['..%2f..%2fetc']])(
    'rejects path traversal: %s',
    (input) => {
      expect(() => parseSlug(input)).toThrow(InvalidSlugError);
    },
  );

  it('rejects a repo that is a bare dot', () => {
    expect(() => parseSlug('owner/.')).toThrow(InvalidSlugError);
  });

  it('rejects an owner longer than GitHub allows', () => {
    expect(() => parseSlug(`${'a'.repeat(40)}/repo`)).toThrow(InvalidSlugError);
  });

  it('accepts an owner exactly at the 39-character limit', () => {
    expect(parseSlug(`${'a'.repeat(39)}/repo`).owner).toHaveLength(39);
  });
});

describe('isValidSlug', () => {
  it('is true for a real slug', () => {
    expect(isValidSlug('owner/repo')).toBe(true);
  });

  it('is false rather than throwing for junk', () => {
    expect(isValidSlug('../../etc')).toBe(false);
  });
});
