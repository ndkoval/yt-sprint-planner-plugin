import { test, expect, openTab, guardErrors, assertAccessible } from './helpers.js';

test.describe('Project tab overview', () => {
  test('renders header, capacity table, summaries and effort with real metrics', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    await openTab(page, 'manager');

    // Header controls (§6.1).
    for (const label of ['Create next Sprint', 'Open board', 'Recalculate', 'Refresh']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }

    // Capacity table lists the team (§6.3).
    await expect(page.getByText('Alice Smith')).toBeVisible();
    await expect(page.getByText('Bob Jones')).toBeVisible();
    await expect(page.getByText('Charlie Diaz')).toBeVisible();

    // Capacity + effort summaries render computed values (§6.4/§6.5).
    await expect(page.getByText('Raw capacity')).toBeVisible();
    await expect(page.getByText('Planned capacity')).toBeVisible();
    await expect(page.getByText('Original effort')).toBeVisible();
    await expect(page.getByText('Observed focus factor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data health' })).toBeVisible();
    await expect(page.getByText('Up to date')).toBeVisible();

    await info.attach('overview.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await assertAccessible(page, info, 'overview');
    assertClean();
  });
});
