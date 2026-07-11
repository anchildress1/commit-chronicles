/**
 * Repo slugs arrive from the URL bar and from POST bodies, and they are concatenated
 * into bucket object keys. Anything that could climb out of the `cards/` prefix, or
 * that GitHub could not have minted in the first place, is rejected here.
 */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;

export interface RepoSlug {
  owner: string;
  repo: string;
  /** Canonical `owner/repo`, lowercased. */
  slug: string;
}

export class InvalidSlugError extends Error {
  constructor(readonly input: string) {
    super(`not a valid GitHub repository: ${input}`);
    this.name = 'InvalidSlugError';
  }
}

/**
 * Normalize user input into an `owner/repo` slug.
 *
 * Accepts a bare slug, a github.com URL, an `.git` suffix, and stray whitespace or
 * trailing slashes. Throws {@link InvalidSlugError} on anything else.
 */
export function parseSlug(input: string): RepoSlug {
  const cleaned = input
    .trim()
    .replace(/^git\+/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  if (cleaned.includes('..')) {
    throw new InvalidSlugError(input);
  }

  const parts = cleaned.split('/');
  const owner = parts[0];
  const repo = parts[1];

  if (parts.length !== 2 || owner === undefined || repo === undefined) {
    throw new InvalidSlugError(input);
  }

  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.') {
    throw new InvalidSlugError(input);
  }

  const lowerOwner = owner.toLowerCase();
  const lowerRepo = repo.toLowerCase();
  return { owner: lowerOwner, repo: lowerRepo, slug: `${lowerOwner}/${lowerRepo}` };
}

/** True when `input` is a slug this service will act on. Never throws. */
export function isValidSlug(input: string): boolean {
  try {
    parseSlug(input);
    return true;
  } catch {
    return false;
  }
}
