import { test, expect, openTab, guardErrors } from './helpers.js';

/**
 * How issues look per Sprint, and navigating between Sprints: switch Sprints with the
 * header selector (each shows its own goal + effort/issue picture), then open the board
 * to see the issues and jump back into the planner for a chosen Sprint.
 */
test.describe('Sprint navigation & issues', () => {
  test('switch Sprints via the selector; open the board and jump into a Sprint', async ({
    page,
    context,
  }, info) => {
    const assertClean = guardErrors(page);

    // Completed Sprint (S1) selected by default: shows its goal + observed focus factor.
    await openTab(page, 'manager', 'sprint-1');
    await expect(page.getByText('Ship the first customer preview')).toBeVisible();

    // Switch to the active Sprint via the selector; its goal + missing-effort warning show.
    await page.getByRole('combobox').first().click();
    await page.getByText('AppGlass 2026-S2', { exact: true }).click();
    await expect(page.getByText('Deliver a usable first customer deployment')).toBeVisible();
    await expect(page.getByText(/missing Original Effort/i)).toBeVisible();

    // Open the board (opens in a new tab) and confirm the Sprint's issues are listed.
    const [board] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open board' }).click(),
    ]);
    await board.waitForLoadState('networkidle');
    await expect(board.getByRole('heading', { name: 'AppGlass Board' })).toBeVisible();
    await expect(board.getByRole('cell', { name: 'AG-10', exact: true })).toBeVisible();
    await expect(board.getByRole('cell', { name: 'AG-11', exact: true })).toBeVisible();
    await info.attach('board.png', {
      body: await board.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    // Jump into a Sprint from the board — lands in the planner for that Sprint.
    await board.getByRole('link', { name: /2026-S2.*Sprint Capacity/ }).click();
    await board.waitForLoadState('networkidle');
    await expect(board.getByText('Deliver a usable first customer deployment')).toBeVisible();

    assertClean();
  });
});
