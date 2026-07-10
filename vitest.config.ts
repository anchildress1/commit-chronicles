import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setup-tests.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'worker/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'worker/**/*.ts'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', '**/*.{test,spec}.{ts,tsx}'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 80,
      },
    },
  },
});
