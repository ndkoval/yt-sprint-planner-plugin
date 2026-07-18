import { test, expect, openTab, guardErrors } from './helpers.js';

/**
 * Assigning tasks to people while planning, with an Unassigned bucket. The capacity
 * table shows each person's assigned load (current effort on their issues) next to their
 * available capacity, and the effort summary shows the unassigned remainder — so you can
 * balance the team while still leaving work owned by project direction, not forced onto a
 * person. Assigned load updates automatically as issues change.
 */
test.describe('Per-assignee planning', () => {
  test('assigned load per person + unassigned bucket, updating automatically', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    await openTab(page, 'manager', 'sprint-2');

    const assignedCell = (name: string) =>
      page.locator('tr', { hasText: name }).locator('td').nth(3);
    const loadCell = (name: string) =>
      page.locator('tr', { hasText: name }).locator('td').nth(4);
    const unassigned = page
      .locator('dt', { hasText: 'Unassigned' })
      .locator('xpath=following-sibling::dd');

    // Seeded: Alice AG-10 (5d current), Bob AG-12 (3.75d), AG-13 (1.25d) unassigned.
    await expect(assignedCell('Alice Smith')).toHaveText('5');
    await expect(assignedCell('Bob Jones')).toHaveText('3.75');
    await expect(assignedCell('Charlie Diaz')).toHaveText('0');
    // The summary metric rounds to one decimal (1.25d → "1.3d"); table cells show 2 decimals.
    await expect(unassigned).toHaveText('1.3d');

    // Load column = committed Original Effort vs available capacity (the per-person
    // capacity-vs-commitment indicator). Alice is committed 15d (AG-10 + AG-11) against
    // 8d available → over; Charlie carries nothing.
    await expect(loadCell('Alice Smith')).toContainText('15/8');
    await expect(loadCell('Alice Smith')).toContainText('⚠ over');
    await expect(loadCell('Charlie Diaz')).toContainText('0/');

    // Sprint-level "what fits" banner: committed Original Effort vs planned capacity.
    const fitBanner = page.getByRole('status').filter({ hasText: 'Committed' });
    await expect(fitBanner).toBeVisible();
    await expect(fitBanner).toContainText('vs planned');

    // Plan more work: assign a task to Charlie and add one that stays unassigned.
    await page.evaluate(async () => {
      await fetch('/__demo/add-issue?sprintId=sprint-2&originalMinutes=1440&currentMinutes=1440&assigneeId=1-3', { method: 'POST' });
      await fetch('/__demo/add-issue?sprintId=sprint-2&originalMinutes=480&currentMinutes=480', { method: 'POST' });
    });
    // Charlie now carries 3d; the unassigned bucket grew by 1d — reflected automatically
    // by auto-refresh (no button to click).
    await expect(assignedCell('Charlie Diaz')).toHaveText('3', { timeout: 15_000 });
    await expect(unassigned).toHaveText('2.3d');

    await info.attach('assignment.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    assertClean();
  });
});
