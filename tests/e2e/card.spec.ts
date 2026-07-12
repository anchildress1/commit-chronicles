import { expect, test, type Page } from '@playwright/test';

/** Stand in for Cloud Run. The SPA cannot tell the difference, which is the point. */
async function stubApi(
  page: Page,
  states: Record<string, unknown>,
  onGenerate: 'accept' | 'quota' = 'accept',
): Promise<void> {
  await page.route('**/api/state/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/state/', '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(states[path] ?? { status: 'unknown', repo: path }),
    });
  });

  await page.route('**/api/generate', async (route) => {
    if (onGenerate === 'quota') {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'quota_exceeded' }),
      });
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'generating', repo: 'atlas/pipeline' }),
    });
  });

  await page.route('**/card.svg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>',
    });
  });
}

test('the landing page asks for one thing', async ({ page }) => {
  await stubApi(page, {});
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every repo is a story');
  await expect(page.getByLabel('GitHub repository, as owner/repo')).toBeVisible();
});

test('a bad slug is refused before it reaches the server', async ({ page }) => {
  await stubApi(page, {});
  await page.goto('/');

  await page.getByLabel('GitHub repository, as owner/repo').fill('not-a-repo');
  await page.getByRole('button', { name: 'Read →' }).click();

  await expect(page.getByRole('alert')).toContainText('owner/repo');
  await expect(page).toHaveURL('/');
});

test('submitting a repo routes to it and shows the reading state', async ({ page }) => {
  await stubApi(page, {});
  await page.goto('/');

  await page.getByLabel('GitHub repository, as owner/repo').fill('atlas/pipeline');
  await page.getByRole('button', { name: 'Read →' }).click();

  await expect(page).toHaveURL('/atlas/pipeline');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Cortex is reading');
});

test('a ready repo shows the card and the README embed', async ({ page }) => {
  await stubApi(page, {
    'atlas/pipeline': {
      status: 'ready',
      repo: 'atlas/pipeline',
    },
  });

  await page.goto('/atlas/pipeline');

  await expect(page.getByRole('img', { name: /Commit Chronicles card/ })).toBeVisible();
  await expect(page.getByText('[![Commit Chronicle]', { exact: false })).toContainText(
    '/atlas/pipeline/card.svg',
  );
});

test('the shell keeps the brand colour', async ({ page }) => {
  // Cortex's accent is a reading of one repo's arc: it belongs on that repo's card, which
  // is an SVG that carries the colour itself. The state endpoint does not even report it,
  // so the shell has nothing to repaint itself with — which is the point.
  await stubApi(page, {
    'atlas/pipeline': {
      status: 'ready',
      repo: 'atlas/pipeline',
    },
  });

  await page.goto('/atlas/pipeline');
  await expect(page.getByRole('img', { name: /Commit Chronicles card/ })).toBeVisible();

  const accent = await page
    .locator('main')
    .evaluate((node) => getComputedStyle(node).getPropertyValue('--accent').trim());

  expect(accent).toBe('#2ec4ff');
  expect(accent).not.toBe('#d3e85a');
});

test('a failed repo says why, and offers the field again', async ({ page }) => {
  await stubApi(page, {
    'ghost/nothing': {
      status: 'failed',
      repo: 'ghost/nothing',
      errorCode: 'repo_not_found',
      failedAt: '2026-07-11',
    },
  });

  await page.goto('/ghost/nothing');

  await expect(page.getByRole('heading', { level: 2 })).toContainText('Nothing to read here');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a spent budget is stated plainly rather than spinning', async ({ page }) => {
  await stubApi(page, {}, 'quota');

  await page.goto('/atlas/pipeline');

  await expect(page.getByRole('alert')).toContainText('generation budget');
});
