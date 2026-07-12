import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Server tests run in node; client tests opt into jsdom with a per-file docblock.
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      // Boot wiring, the driver wrapper, and presentational shells carry no branches
      // worth asserting. Coverage is a floor on logic, not a participation trophy.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Boot wiring: no branches of ours to assert.
        'src/server/index.ts',
        'src/server/rerender.ts',
        'src/client/main.tsx',
        // SDK adapters: the logic under test would be the vendor's.
        'src/server/snowflake.ts',
        'src/server/queue.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
