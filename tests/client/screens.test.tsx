/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Failed } from '../../src/client/screens/Failed.js';
import { EXAMPLES, Landing } from '../../src/client/screens/Landing.js';
import { Loading } from '../../src/client/screens/Loading.js';
import { Nav } from '../../src/client/screens/Nav.js';
import { RepoEntry } from '../../src/client/screens/RepoEntry.js';
import { parseSlug } from '../../src/shared/slug.js';

const SLUG = parseSlug('atlas/pipeline');

describe('RepoEntry', () => {
  it('hands back a normalized slug', async () => {
    const onSubmit = vi.fn();
    render(<RepoEntry onSubmit={onSubmit} submitLabel="Read" />);

    await userEvent.type(
      screen.getByLabelText('GitHub repository, as owner/repo'),
      'https://github.com/Atlas/Pipeline',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Read' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'atlas/pipeline' }));
  });

  it('refuses junk before it reaches the server', async () => {
    const onSubmit = vi.fn();
    render(<RepoEntry onSubmit={onSubmit} submitLabel="Read" />);

    await userEvent.type(screen.getByLabelText('GitHub repository, as owner/repo'), 'not-a-repo');
    await userEvent.click(screen.getByRole('button', { name: 'Read' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('owner/repo');
  });

  it('cannot submit an empty field', () => {
    render(<RepoEntry onSubmit={vi.fn()} submitLabel="Read" />);
    expect(screen.getByRole('button', { name: 'Read' })).toBeDisabled();
  });
});

describe('Failed', () => {
  it('offers a retry the server will honour', async () => {
    const onRetry = vi.fn();
    render(<Failed slug={SLUG} onSubmit={vi.fn()} onRetry={onRetry} errorCode="cortex_rejected" />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('came back wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Read it again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no retry for a failure that can never change', () => {
    render(<Failed slug={SLUG} onSubmit={vi.fn()} onRetry={vi.fn()} errorCode="repo_not_found" />);

    expect(screen.queryByRole('button', { name: 'Read it again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('falls back when the code is unrecognised', () => {
    render(<Failed slug={SLUG} onSubmit={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nothing to read here');
  });

  it('prefers an explicit reason over the code’s copy', () => {
    render(
      <Failed slug={SLUG} onSubmit={vi.fn()} onRetry={vi.fn()} reason="the budget is spent" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('the budget is spent');
  });
});

describe('Landing', () => {
  it('submits an example without the reader typing', async () => {
    const onSubmit = vi.fn();
    render(<Landing onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: EXAMPLES[2]! }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: EXAMPLES[2] }));
  });
});

describe('Loading', () => {
  it('says which repo it is reading, and that it keeps going', () => {
    render(<Loading slug={SLUG} />);

    expect(screen.getByText('atlas/pipeline')).toBeInTheDocument();
    expect(screen.getByText(/leave the tab, it keeps going/)).toBeInTheDocument();
  });
});

describe('Nav', () => {
  it('goes home', async () => {
    const onHome = vi.fn();
    render(<Nav onHome={onHome} />);

    await userEvent.click(screen.getByRole('button', { name: /Commit Chronicles/ }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it('focuses the input when the field is clicked anywhere but the button', async () => {
    render(<Landing onSubmit={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: /GitHub repository/i });
    expect(input).not.toHaveFocus();

    // The prefix is decorative, but it looks like part of the field, so it has to act like it.
    await userEvent.click(screen.getByText('github.com/'));
    expect(input).toHaveFocus();
  });

  it('does not steal the click that submits', async () => {
    const onSubmit = vi.fn();
    render(<Landing onSubmit={onSubmit} />);

    const input = screen.getByRole('textbox', { name: /GitHub repository/i });
    await userEvent.type(input, 'owner/repo');
    await userEvent.click(screen.getByRole('button', { name: /read/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ slug: 'owner/repo' }));
  });
});
