import type { JSX } from 'react';

interface MarkProps {
  size?: number;
}

/**
 * The product mark: a six-spoke crystal with a glow behind it.
 *
 * The same mark signs the card, so the thing in someone's README and the thing at the top
 * of the page are recognisably one product.
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
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="13" cy="13" r="13" fill="url(#markGlow)" />

      {[0, 60, 120].map((deg) => (
        <line
          key={deg}
          x1="13"
          y1="5"
          x2="13"
          y2="21"
          stroke="var(--accent)"
          strokeWidth="1.6"
          strokeLinecap="round"
          transform={`rotate(${deg} 13 13)`}
        />
      ))}

      <circle cx="13" cy="13" r="2.4" fill="var(--accent)" />
    </svg>
  );
}
