import { test, expect, openTab, guardErrors, assertAccessible } from './helpers.js';

test.describe('Create next Sprint', () => {
  test('manager previews the computed name/dates and creates the next Sprint', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    await openTab(page, 'manager');

    await page.getByRole('button', { name: 'Create next Sprint' }).click();

    // Preview is derived from the LATEST Sprint (S2 → S3), not the selected one.
    await expect(page.getByText('AppGlass 2026-S3', { exact: true })).toBeVisible();
    await expect(page.getByText('2026-07-20')).toBeVisible();
    await expect(page.getByText('2026-08-02')).toBeVisible();
    // Carry-over option shows the exact count of unfinished issues and defaults
    // to unchecked (§14.1). S2 has 3 unresolved issues (AG-10, AG-12, AG-13).
    const moveToggle = page.getByText('Carry over 3 unfinished issues from the current Sprint');
    await expect(moveToggle).toBeVisible();
    await expect(
      page.getByText('3 unresolved issues will move to AppGlass 2026-S3'),
    ).toBeVisible();

    await info.attach('create-dialog.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await assertAccessible(page, info, 'create-dialog');

    await page.getByRole('button', { name: 'Create Sprint' }).click();

    // After creation the Sprint list includes S3 (the backend created it for real).
    await expect(page.getByText('AppGlass 2026-S3').first()).toBeVisible({ timeout: 15_000 });
    assertClean();
  });
});
