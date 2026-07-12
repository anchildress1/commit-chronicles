import type { JSX } from 'react';
import { Mark } from './Mark.js';

interface NavProps {
  onHome: () => void;
}

export function Nav({ onHome }: NavProps): JSX.Element {
  return (
    <nav className="nav">
      <button type="button" className="brand" onClick={onHome}>
        <Mark />
        <span className="brand__word">Commit Chronicles</span>
      </button>
    </nav>
  );
}
