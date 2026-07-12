import { useState, type JSX, type SyntheticEvent } from 'react';
import { InvalidSlugError, parseSlug, type RepoSlug } from '../../shared/slug.js';

interface RepoEntryProps {
  onSubmit: (slug: RepoSlug) => void;
  submitLabel: string;
  initialValue?: string;
}

/**
 * The whole product is one field. Bad input is rejected here rather than sent to the
 * server and billed as a failed generation.
 */
export function RepoEntry({
  onSubmit,
  submitLabel,
  initialValue = '',
}: Readonly<RepoEntryProps>): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    try {
      onSubmit(parseSlug(value));
    } catch (cause) {
      if (cause instanceof InvalidSlugError) {
        setError('That is not an owner/repo. Try `owner/repo` or a github.com URL.');
        return;
      }
      throw cause;
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="entry__field">
        <span className="entry__prefix" aria-hidden="true">
          github.com/
        </span>
        <input
          className="entry__input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="owner/repo"
          aria-label="GitHub repository, as owner/repo"
          aria-invalid={error !== null}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button type="submit" className="btn-primary" disabled={value.trim().length === 0}>
          {submitLabel}
        </button>
      </div>
      {error ? (
        <p className="entry__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
