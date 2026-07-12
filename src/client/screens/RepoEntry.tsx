import { useRef, useState, type JSX, type MouseEvent, type SyntheticEvent } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  // The field reads as one control, so every part of it has to behave like one — the
  // `github.com/` prefix and the padding around it included. A <label> would do this for
  // free, but a label may not contain a second labelable element, and the submit button is
  // one. Clicks that land on the button are left alone.
  const focusInput = (event: MouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    inputRef.current?.focus();
  };

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
      <div className="entry__field" onClick={focusInput}>
        <span className="entry__prefix" aria-hidden="true">
          github.com/
        </span>
        <input
          ref={inputRef}
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
