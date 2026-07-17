import { test, expect, openTab, guardErrors, assertAccessible, toggleConfirm } from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * The comprehensive product walkthrough — the "sales reel". One continuous, deterministic
 * journey through the whole value story: see a Sprint's capacity & effort at a glance,
 * create the next Sprint in one click, have a team member set and confirm availability,
 * watch remaining capacity update automatically as work is added, and open the board to
 * see the issues. Recorded end-to-end as a single video.
 */
test.describe('Sprint Capacity Planner — product walkthrough', () => {
  test('plan a Sprint end to end', async ({ page, context }, info) => {
    const assertClean = guardErrors(page);
    // Brief pauses make the recorded reel watchable; they do not affect assertions.
    const beat = () => page.waitForTimeout(700);

    // ── 1. The planner on the active Sprint: capacity, effort, remaining, data health.
    await openTab(page, 'manager', 'sprint-2');
    await expect(page.getByText('Deliver a usable first customer deployment')).toBeVisible();
    await expect(page.getByText('Raw capacity')).toBeVisible();
    await expect(page.getByText('Remaining capacity')).toBeVisible();
    await expect(page.getByText('Observed focus factor')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data health' })).toBeVisible();
    await assertAccessible(page, info, 'walkthrough-overview');
    await beat();

    // ── 2. Create the next Sprint in one click — name, dates and focus factor computed.
    await page.getByRole('button', { name: 'Create next Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3')).toBeVisible();
    await expect(page.getByText('2026-07-20')).toBeVisible();
    await beat();
    await page.getByRole('button', { name: 'Create Sprint' }).click();
    await expect(page.getByText('AppGlass 2026-S3').first()).toBeVisible({ timeout: 15_000 });
    const sprintId = await page.evaluate(async (api) => {
      const list = (await (await fetch(`${api}/sprints?projectId=proj-demo`)).json()) as Array<{
        id: string;
        name: string;
      }>;
      return list.find((s) => s.name === 'AppGlass 2026-S3')?.id ?? '';
    }, API);
    expect(sprintId).not.toBe('');
    await beat();

    // ── 3. A team member sets availability and confirms it (never blocks anyone).
    await openTab(page, 'alice', sprintId);
    const alice = page.getByLabel('Available capacity in days for Alice Smith');
    await alice.fill('8');
    await alice.blur();
    await expect(alice).toHaveValue('8', { timeout: 15_000 });
    await toggleConfirm(page, 'Alice Smith');
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 15_000 });
    await beat();

    // ── 4. Work is added on the board → remaining capacity updates automatically.
    await openTab(page, 'manager', sprintId);
    const remaining = page
      .locator('dt', { hasText: 'Remaining capacity' })
      .locator('xpath=following-sibling::dd');
    const remainingBefore = (await remaining.textContent())?.trim();
    await page.evaluate(
      ([id]) =>
        fetch(`/__demo/add-issue?sprintId=${id}&originalMinutes=2400&currentMinutes=2400`, {
          method: 'POST',
        }).then((r) => r.ok),
      [sprintId] as const,
    );
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => (await remaining.textContent())?.trim()).not.toBe(remainingBefore);
    await beat();

    // ── 5. Open the board to see the issues behind the numbers.
    const [board] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open board' }).click(),
    ]);
    await board.waitForLoadState('networkidle');
    await expect(board.getByRole('heading', { name: 'AppGlass Board' })).toBeVisible();
    await info.attach('walkthrough-board.png', {
      body: await board.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    assertClean();
  });
});
