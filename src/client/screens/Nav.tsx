import type { JSX } from 'react';
interface NavProps {
  onHome: () => void;
}

export function Nav({ onHome }: NavProps): JSX.Element {
  return (
    <nav className="nav">
      <button type="button" className="brand" onClick={onHome}>
        <span className="brand__mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand__word">Commit Chronicles</span>
      </button>
      <div className="nav__meta">
        <span className="nav__live">
          <span aria-hidden="true" />
          live
        </span>
      </div>
    </nav>
  );
}
