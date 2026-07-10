import { expect, test } from '@playwright/test';

test('landing page renders the project title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /commit chronicles/i })).toBeVisible();
});

test('GET /api/health returns ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toEqual({ status: 'ok' });
});
