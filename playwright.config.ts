import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E suite drives the SPA against a stub API — it proves the screens, the routing,
 * and the polling attach, not Snowflake. Spending a Cortex call per CI run to assert a
 * button label would be an expensive way to test a button label.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:5273',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
