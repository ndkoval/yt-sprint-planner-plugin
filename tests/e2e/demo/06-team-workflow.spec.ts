import { test, expect, openTab, guardErrors, assertAccessible, toggleConfirm } from './helpers.js';

/**
 * The real end-to-end team workflow (§2): a manager creates the next Sprint, then each
 * team member updates and CONFIRMS their own availability, and the capacity summary
 * reflects the confirmations. Confirmation is informational and never blocks.
 */
test.describe('Team workflow: create → set availability → confirm', () => {
  test('manager creates the Sprint, members confirm, summary updates', async ({ page }, info) => {
    const assertClean = guardErrors(page);

    // 1) Manager creates the next Sprint (S3).
    await openTab(page, 'manager');
    await page.getByRole('button', { name: 'Create next Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3')).toBeVisible();
    await page.getByRole('button', { name: 'Create Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3').first()).toBeVisible({ timeout: 15_000 });

    // Find the new Sprint's id so members can deep-link to it.
    const created = await page.evaluate(async () => {
      const res = await fetch(
        '/api/apps/sprint-capacity-planner/backend/sprints?projectId=proj-demo',
      );
      const list = (await res.json()) as Array<{ id: string; name: string }>;
      return list.find((s) => s.name === 'AppGlass 2026-S3')?.id ?? null;
    });
    expect(created).not.toBeNull();
    const sprintId = created as string;

    // A fresh Sprint starts with nobody confirmed.
    await openTab(page, 'manager', sprintId);
    await expect(page.getByText('Participants confirmed')).toBeVisible();
    await expect(page.getByText('0/3')).toBeVisible();

    // 2) Alice adjusts her availability and confirms.
    await openTab(page, 'alice', sprintId);
    const aliceAvailable = page.getByLabel('Available capacity in days for Alice Smith');
    await aliceAvailable.fill('8');
    await aliceAvailable.blur();
    await expect(aliceAvailable).toHaveValue('8', { timeout: 15_000 });
    await toggleConfirm(page, 'Alice Smith');
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 15_000 });
    await assertAccessible(page, info, 'member-confirm');

    // 3) Bob confirms too.
    await openTab(page, 'bob', sprintId);
    await toggleConfirm(page, 'Bob Jones');
    await expect(page.getByText('2/3')).toBeVisible({ timeout: 15_000 });

    // 4) Manager sees the updated confirmation count — nothing was blocked along the way.
    await openTab(page, 'manager', sprintId);
    await expect(page.getByText('2/3')).toBeVisible();
    await info.attach('team-workflow.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    assertClean();
  });
});
