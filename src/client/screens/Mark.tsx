import type { JSX } from 'react';

interface MarkProps {
  size?: number;
}

/**
 * The product mark: three commits falling later into the night, the last one lit.
 *
 * The card's own grammar — a hollow daylight dot, a night dot, and the accent dot that ends
 * the story. The same mark signs the card, so the page and the README read as one product.
 */
export function Mark({ size = 26 }: MarkProps): JSX.Element {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="markGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle
        cx="5"
        cy="8"
        r="2"
        fill="none"
        stroke="var(--ink)"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      <circle cx="13" cy="13" r="2.2" fill="var(--ink)" fillOpacity="0.8" />
      <circle cx="21" cy="18" r="7" fill="url(#markGlow)" />
      <circle cx="21" cy="18" r="3" fill="var(--accent)" />
    </svg>
  );
}
