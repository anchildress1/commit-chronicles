/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '../../src/client/screens/Footer.js';

describe('Footer', () => {
  it('links to the site, every social, and Snowflake', () => {
    render(<Footer />);

    const expected = [
      ['Website', 'https://anchildress1.dev'],
      ['GitHub', 'https://github.com/anchildress1'],
      ['LinkedIn', 'https://www.linkedin.com/in/anchildress1'],
      ['DEV Community', 'https://dev.to/anchildress1'],
      ['Powered by Snowflake', 'https://www.snowflake.com/en/product/features/cortex/'],
    ] as const;

    for (const [name, href] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('carries the copyright', () => {
    render(<Footer />);

    expect(screen.getByText(/© 2026 Ashley Childress/)).toBeInTheDocument();
  });

  it('gives every icon-only link an accessible name', () => {
    render(<Footer />);

    // The icons carry no text, so aria-label is the only name a screen reader gets. A link
    // that loses it announces as "link" and is useless.
    for (const label of ['Website', 'GitHub', 'LinkedIn', 'DEV Community']) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('aria-label', label);
      expect(link).toHaveAttribute('title', label);
      expect(link.textContent).toBe('');
    }
  });

  it('hides the decorative icons from screen readers', () => {
    const { container } = render(<Footer />);

    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    }
  });

  it('opens off-site links without handing them a reference to this page', () => {
    render(<Footer />);

    for (const link of screen.getAllByRole('link')) {
      // target=_blank without noopener lets the opened page reach back through window.opener.
      if (link.getAttribute('target') !== '_blank') continue;
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('renders no link with an empty or relative href', () => {
    render(<Footer />);

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/\S+$/);
    }
  });
});
