import type { JSX } from 'react';

interface Social {
  /** The accessible name. An icon-only link has no text, so this is the only name it gets. */
  label: string;
  href: string;
  /** Inline so the icons cost no request and survive a strict CSP. */
  path: string;
}

const SOCIALS: readonly Social[] = [
  {
    label: 'Website',
    href: 'https://anchildress1.dev',
    path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.93 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14A7.96 7.96 0 0 1 4 12c0-.69.1-1.36.26-2h3.38a16.6 16.6 0 0 0 0 4H4.26zm.81 2h2.95c.3 1.26.76 2.46 1.38 3.56A7.99 7.99 0 0 1 5.07 16zm2.95-8H5.07a7.99 7.99 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.9 14.9 0 0 1 0-4h4.68a14.9 14.9 0 0 1 0 4zm.26 5.56c.62-1.1 1.08-2.3 1.38-3.56h2.95a7.99 7.99 0 0 1-4.33 3.56zM16.36 14a16.6 16.6 0 0 0 0-4h3.38c.16.64.26 1.31.26 2 0 .69-.1 1.36-.26 2h-3.38z',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/anchildress1',
    path: 'M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.01-2.05c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.82 1.1.82 2.22l-.01 3.29c0 .32.21.7.82.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/anchildress1',
    path: 'M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.66H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z',
  },
  {
    label: 'DEV Community',
    href: 'https://dev.to/anchildress1',
    path: 'M7.42 10.05c-.18-.16-.46-.23-.86-.23H5.9v4.36h.66c.4 0 .68-.09.86-.23.18-.15.28-.42.28-.83v-2.24c0-.4-.1-.68-.28-.83zM0 4.94v14.12A2.94 2.94 0 0 0 2.94 22h18.12A2.94 2.94 0 0 0 24 19.06V4.94A2.94 2.94 0 0 0 21.06 2H2.94A2.94 2.94 0 0 0 0 4.94zm8.56 8.16c0 .77-.24 1.4-.71 1.9-.48.5-1.12.74-1.93.74H4.15V8.26h1.83c.79 0 1.42.25 1.89.74.47.5.7 1.12.7 1.87v2.23zm4.8-3.1h-2.06v1.22h1.26v1.55h-1.26v1.25h2.06v1.62H9.9c-.31 0-.56-.25-.56-.56V8.82c0-.31.25-.56.56-.56h3.46V10zm4.85 5.06c-.16.4-.42.7-.83.7-.4 0-.66-.3-.82-.7l-1.7-6.8h1.79l.73 4.6.74-4.6h1.79l-1.7 6.8z',
  },
];

const SNOWFLAKE_PATH =
  'M12 1.6c.55 0 1 .45 1 1v2.2l1.2-.7a1 1 0 1 1 1 1.74l-2.2 1.27v2.32l2-1.16V6.73a1 1 0 0 1 2 0v1.39l1.9-1.1a1 1 0 1 1 1 1.73l-1.9 1.1 1.2.7a1 1 0 1 1-1 1.73l-2.2-1.27-2 1.16 2 1.16 2.2-1.27a1 1 0 1 1 1 1.73l-1.2.7 1.9 1.1a1 1 0 1 1-1 1.73l-1.9-1.1v1.39a1 1 0 0 1-2 0v-2.54l-2-1.16v2.32l2.2 1.27a1 1 0 1 1-1 1.74l-1.2-.7v2.2a1 1 0 0 1-2 0v-2.2l-1.2.7a1 1 0 0 1-1-1.74l2.2-1.27v-2.32l-2 1.16v2.54a1 1 0 0 1-2 0v-1.39l-1.9 1.1a1 1 0 0 1-1-1.73l1.9-1.1-1.2-.7a1 1 0 1 1 1-1.73l2.2 1.27 2-1.16-2-1.16-2.2 1.27a1 1 0 1 1-1-1.73l1.2-.7-1.9-1.1a1 1 0 0 1 1-1.73l1.9 1.1V6.73a1 1 0 1 1 2 0v2.54l2 1.16V8.11L8.8 6.84a1 1 0 0 1 1-1.74l1.2.7V2.6c0-.55.45-1 1-1z';

function Icon({ path }: Readonly<{ path: string }>): JSX.Element {
  return (
    <svg
      className="footer__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer className="footer">
      <p className="footer__legal">
        © 2026 Ashley Childress ·{' '}
        <a
          className="footer__legal-link"
          href="https://github.com/anchildress1/commit-chronicles/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer noopener"
        >
          PolyForm Shield 1.0.0
        </a>
      </p>

      <a
        className="footer__powered"
        href="https://www.snowflake.com/en/product/features/cortex/"
        target="_blank"
        rel="noreferrer noopener"
      >
        <Icon path={SNOWFLAKE_PATH} />
        Powered by Snowflake
      </a>

      <ul className="footer__socials">
        {SOCIALS.map((social) => (
          <li key={social.label}>
            {/* Icon-only: aria-label is the entire accessible name, and title gives sighted
                users the same one on hover. */}
            <a
              className="footer__social"
              href={social.href}
              aria-label={social.label}
              title={social.label}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon path={social.path} />
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
