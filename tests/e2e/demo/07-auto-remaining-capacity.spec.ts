import { test, expect, openTab, guardErrors } from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/** Read planned/current/remaining (minutes) straight from the backend for assertions. */
async function readMetrics(page: import('@playwright/test').Page, sprintId: string) {
  return page.evaluate(
    async ([api, id]) => {
      const res = await fetch(`${api}/sprints/${id}?projectId=proj-demo`);
      const v = (await res.json()) as {
        plannedCapacityMinutes: number;
        currentEffortMinutes: number;
      };
      return {
        planned: v.plannedCapacityMinutes,
        current: v.currentEffortMinutes,
        remaining: v.plannedCapacityMinutes - v.currentEffortMinutes,
      };
    },
    [API, sprintId] as const,
  );
}

test.describe('Remaining capacity updates automatically when a task is added', () => {
  test('adding + estimating a task lowers remaining capacity with no manual action', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    const sprintId = 'sprint-2';
    await openTab(page, 'manager', sprintId);

    const remainingCell = page
      .locator('dt', { hasText: 'Remaining capacity' })
      .locator('xpath=following-sibling::dd');
    await expect(remainingCell).toBeVisible();
    const before = await readMetrics(page, sprintId);
    const remainingTextBefore = (await remainingCell.textContent())?.trim();

    // Simulate the board+workflow: add a task with 1800 min (≈3.75d) of current effort.
    // The backend reconciles automatically (as the on-change workflow would); the user
    // takes no action in the app beyond refreshing to see the current state.
    const added = await page.evaluate(async () => {
      const res = await fetch(
        '/__demo/add-issue?sprintId=sprint-2&originalMinutes=1800&currentMinutes=1800',
        { method: 'POST' },
      );
      return res.ok;
    });
    expect(added).toBe(true);

    // Backend metrics updated automatically (the core guarantee).
    const after = await readMetrics(page, sprintId);
    expect(after.current).toBe(before.current + 1800);
    expect(after.remaining).toBe(before.remaining - 1800);

    // The UI reflects it automatically (auto-refresh polling) — no button to click.
    await expect
      .poll(async () => (await remainingCell.textContent())?.trim(), { timeout: 15_000 })
      .not.toBe(remainingTextBefore);

    await info.attach('remaining-after-add.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    assertClean();
  });
});
