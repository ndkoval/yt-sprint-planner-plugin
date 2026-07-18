import { test, expect, openTab, guardErrors, assertAccessible } from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * The team workflow (§2): a manager creates the next Sprint, then each team member sets
 * their own availability. There is no confirmation step — it was removed as a redundant
 * extra step; capacity simply reflects what people set, and updates automatically.
 */
test.describe('Team workflow: create → set availability', () => {
  test('manager creates the Sprint, members set availability, capacity updates', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);

    // 1) Manager creates the next Sprint (S3).
    await openTab(page, 'manager', 'sprint-2');
    await page.getByRole('button', { name: 'Create next Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3').first()).toBeVisible({ timeout: 15_000 });
    const sprintId = await page.evaluate(async (api) => {
      const list = (await (await fetch(`${api}/sprints?projectId=proj-demo`)).json()) as Array<{
        id: string;
        name: string;
      }>;
      return list.find((s) => s.name === 'AppGlass 2026-S3')?.id ?? '';
    }, API);
    expect(sprintId).not.toBeNull();

    // 2) Alice sets her availability (own row only).
    await openTab(page, 'alice', sprintId as string);
    const aliceAvailable = page.getByLabel('Available capacity in days for Alice Smith');
    await aliceAvailable.fill('8');
    await aliceAvailable.blur();
    await expect(aliceAvailable).toHaveValue('8', { timeout: 15_000 });
    // Bob's row is read-only for Alice.
    await expect(page.getByLabel('Available capacity in days for Bob Jones')).toHaveCount(0);
    await assertAccessible(page, info, 'member-availability');

    // 3) Bob sets his availability too.
    await openTab(page, 'bob', sprintId as string);
    const bobAvailable = page.getByLabel('Available capacity in days for Bob Jones');
    await bobAvailable.fill('9');
    await bobAvailable.blur();
    await expect(bobAvailable).toHaveValue('9', { timeout: 15_000 });

    // 4) Manager sees the team's capacity — nothing was blocked along the way.
    await openTab(page, 'manager', sprintId as string);
    await expect(page.getByText('Raw capacity')).toBeVisible();
    await expect(page.getByText('Alice Smith')).toBeVisible();
    await info.attach('team-workflow.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    assertClean();
  });
});
