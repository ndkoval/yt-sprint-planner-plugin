import { test, expect, openTab, guardErrors, assertAccessible } from './helpers.js';

test.describe('Manager controls', () => {
  test('recalculates and overrides the focus factor (no locks, always editable)', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    await openTab(page, 'manager');

    // Recalculate runs authoritative reconciliation and reports up-to-date (§6.6/§13).
    await page.getByRole('button', { name: 'Recalculate' }).click();
    await expect(page.getByText('Up to date')).toBeVisible({ timeout: 15_000 });

    // Manager-only Override focus factor (§11.6): requires a reason; records the change.
    await page.getByRole('button', { name: 'Override focus factor' }).click();
    // Ring associates the label prop via <label for>, so getByLabel is unique here.
    const percent = page.getByLabel('New focus factor (%)');
    await expect(percent).toBeVisible();
    await percent.fill('70');
    await page.getByLabel('Reason').fill('Team ran a spike; adjusting for the next Sprint');
    await assertAccessible(page, info, 'override-dialog');
    await info.attach('override-dialog.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Apply override' }).click();

    // Focus factor now reflects the manual value (70%).
    await expect(page.getByText('70%').first()).toBeVisible({ timeout: 15_000 });
    assertClean();
  });
});
