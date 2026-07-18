import { test, expect, openTab, guardErrors, assertAccessible } from './helpers.js';

test.describe('Member availability (Alice)', () => {
  test('edits only her own row; other rows are read-only', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    await openTab(page, 'alice');

    // Alice can edit her own Available / Note.
    const aliceAvailable = page.getByLabel('Available capacity in days for Alice Smith');
    await expect(aliceAvailable).toBeEnabled();
    await expect(page.getByLabel('Note for Alice Smith')).toBeEnabled();

    // Bob's row is read-only for Alice: no editable inputs (§6.3/§16.1).
    await expect(page.getByLabel('Available capacity in days for Bob Jones')).toHaveCount(0);
    await expect(page.getByLabel('Note for Bob Jones')).toHaveCount(0);

    // Edit Alice's available capacity; it commits on blur and persists.
    await aliceAvailable.fill('9');
    await aliceAvailable.blur();
    await expect(aliceAvailable).toHaveValue('9', { timeout: 15_000 });

    await info.attach('member-availability.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await assertAccessible(page, info, 'member-availability');
    assertClean();
  });
});
