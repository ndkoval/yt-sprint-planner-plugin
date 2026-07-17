import { test, expect, openSettings, guardErrors, assertAccessible } from './helpers.js';

test.describe('Project settings', () => {
  test('renders board, effort fields, schedule, focus factor and team sections', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    await openSettings(page, 'manager');

    await expect(page.getByRole('heading', { name: 'Agile board' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Effort field mapping' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Focus factor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    // The naming template documents the real placeholders.
    await expect(page.getByText('{year}', { exact: false })).toBeVisible();

    await info.attach('settings.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await assertAccessible(page, info, 'settings');
    assertClean();
  });
});
