/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Result } from '../../src/client/screens/Result.js';
import { parseSlug } from '../../src/shared/slug.js';

const SLUG = parseSlug('atlas/pipeline');
const CARD = 'https://storage.googleapis.com/cc-cards/cards/atlas/pipeline/card.svg';
const PAGE = 'https://commitchronicles.dev/atlas/pipeline';

/** Swap the clipboard for one that answers however the test needs it to. */
function clipboard(answer: 'accept' | 'refuse'): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() =>
    answer === 'accept' ? Promise.resolve() : Promise.reject(new Error('denied')),
  );
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  return { writeText };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const draw = (): void => {
  render(<Result slug={SLUG} cardUrl={CARD} pageUrl={PAGE} onHome={() => undefined} />);
};

describe('Result', () => {
  it('shows the card straight from the bucket', () => {
    clipboard('accept');
    draw();

    expect(screen.getByRole('img', { name: /Commit Chronicles card/ })).toHaveAttribute(
      'src',
      CARD,
    );
  });

  it('shows the site’s real host rather than a hardcoded one', () => {
    clipboard('accept');
    draw();

    expect(screen.getByText('commitchronicles.dev/')).toBeInTheDocument();
  });

  it('embeds the bucket image and links back to the page', () => {
    clipboard('accept');
    draw();

    const embed = screen.getByText('[![Commit Chronicles]', { exact: false }).textContent ?? '';
    expect(embed).toContain(`(${CARD})`);
    expect(embed).toContain(`(${PAGE})`);
  });

  it('copies the bucket URL, not a link to this service', async () => {
    const { writeText } = clipboard('accept');
    draw();

    await userEvent.click(screen.getByRole('button', { name: /Copy image URL/ }));

    expect(writeText).toHaveBeenCalledWith(CARD);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/ })).toBeInTheDocument();
    });
  });

  it('copies the README embed', async () => {
    const { writeText } = clipboard('accept');
    draw();

    await userEvent.click(screen.getByRole('button', { name: /Copy README embed/ }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`[![Commit Chronicles](${CARD})`),
    );
  });

  it('admits it when the browser refuses the clipboard', async () => {
    // Claiming "copied" on a refused write is worse than saying nothing: the reader walks off
    // and pastes whatever they copied an hour ago.
    clipboard('refuse');
    draw();

    await userEvent.click(screen.getByRole('button', { name: /Copy image URL/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /clipboard refused/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /✓ copied/ })).not.toBeInTheDocument();
  });

  it('goes home when asked', async () => {
    clipboard('accept');
    const onHome = vi.fn();
    render(<Result slug={SLUG} cardUrl={CARD} pageUrl={PAGE} onHome={onHome} />);

    await userEvent.click(screen.getByRole('button', { name: /read another repo/ }));

    expect(onHome).toHaveBeenCalledOnce();
  });

  it('falls back to execCommand when the Clipboard API is absent', async () => {
    // Plain HTTP: navigator.clipboard is not defined at all, so the API call would throw
    // synchronously rather than reject. This is the dev-over-LAN case.
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });

    render(<Result slug={SLUG} cardUrl={CARD} pageUrl={PAGE} onHome={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /copy image url/i }));

    expect(exec).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });

  it('says so when it cannot copy at all', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });

    render(<Result slug={SLUG} cardUrl={CARD} pageUrl={PAGE} onHome={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /copy image url/i }));

    // Never claim a tick we did not earn: the reader would paste something else.
    expect(await screen.findByRole('button', { name: /select it/i })).toBeInTheDocument();

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });
});
