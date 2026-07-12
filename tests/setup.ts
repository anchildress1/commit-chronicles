import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without this each render stacks on the last one and every query finds two of everything.
afterEach(cleanup);
