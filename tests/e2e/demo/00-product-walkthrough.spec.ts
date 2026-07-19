import {
  test,
  expect,
  openTab,
  guardErrors,
  assertAccessible,
  humanClick,
  humanFill,
  moveTo,
  settle,
  Captioner,
  closeTitleCard,
  REEL_WIPE,
} from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * Marketing reel #1 — the comprehensive product walkthrough. One continuous, deterministic,
 * subtitled journey through the whole value story, paced and cursored like a real person:
 * see a Sprint's capacity & effort, create the next Sprint in one click, have a team member
 * set availability, watch remaining capacity update automatically as work is added, and
 * open the Kanban board to see the issues. Recorded end-to-end as one 720p video with a
 * title card, on-screen captions + a WebVTT subtitle track.
 */
test.describe('Marketing reel — product walkthrough', () => {
  test('plan a Sprint end to end', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // ── 1. The planner on the active Sprint: capacity, effort, remaining, data health.
    await openTab(page, 'manager', 'sprint-2', {
      title: 'Sprint Capacity Planner',
      subtitle: 'Plan two-week Sprints on native YouTrack',
    });
    await cap.say('Sprint Capacity Planner — capacity planning on native YouTrack Sprints.');
    await closeTitleCard(page);
    await expect(page.getByText('Deliver a usable first customer deployment')).toBeVisible();
    await moveTo(page, page.getByText('Raw capacity'));
    await cap.say('See raw, planned and remaining capacity at a glance.');
    await expect(page.getByText('Remaining capacity', { exact: true })).toBeVisible();

    // Per-person load: committed Original Effort vs each person's available capacity.
    await moveTo(page, page.getByRole('columnheader', { name: 'Load (committed / capacity)' }));
    await cap.say('Each person shows committed work against their capacity.');
    await cap.say('Over-commitment turns red.');
    await expect(
      page.locator('tr', { hasText: 'Alice Smith' }).locator('td').nth(4),
    ).toContainText('⚠ over');

    // Sprint-level "what fits" check — committed effort vs planned capacity.
    const fitBanner = page.getByRole('status').filter({ hasText: 'Committed' });
    await moveTo(page, fitBanner);
    await cap.say('And the what-fits banner shows whether the plan fits the Sprint.');
    await expect(fitBanner).toContainText('vs planned');

    await expect(page.getByRole('heading', { name: 'Data health' })).toBeVisible();
    await assertAccessible(page, info, 'walkthrough-overview');
    await settle(page, 700);

    // ── 2. Create the next Sprint in one click — name, dates and focus factor computed.
    await cap.say('Create the next Sprint in one click.');
    await humanClick(page, page.getByRole('button', { name: 'Create next Sprint' }));
    await expect(page.getByText('AppGlass 2026-S3', { exact: true })).toBeVisible();
    await cap.say('Name, dates and focus factor are computed for you.');
    await expect(page.getByText('2026-07-20')).toBeVisible();
    await humanFill(
      page,
      page.getByLabel('Goal (optional)', { exact: true }),
      'Deepen reporting and polish onboarding',
    );
    await settle(page, 500);
    // Carry over the unfinished work from the current Sprint, just like Jira's
    // Complete-Sprint step — the exact count is shown.
    await cap.say('Carry over the unfinished work, like Jira’s complete-sprint step.');
    await expect(
      page.getByText('Carry over 3 unfinished issues from the current Sprint'),
    ).toBeVisible();
    const carryOver = page.getByRole('checkbox');
    await moveTo(page, carryOver);
    await carryOver.check();
    await settle(page, 500);
    await humanClick(page, page.getByRole('button', { name: 'Create Sprint' }));
    await expect(page.getByText('AppGlass 2026-S3').first()).toBeVisible({ timeout: 15_000 });
    const sprintId = await page.evaluate(async (api) => {
      const list = (await (await fetch(`${api}/sprints?projectId=proj-demo`)).json()) as Array<{
        id: string;
        name: string;
      }>;
      return list.find((s) => s.name === 'AppGlass 2026-S3')?.id ?? '';
    }, API);
    expect(sprintId).not.toBe('');
    await settle(page, 900);

    // ── 3. A team member sets availability and confirms it (never blocks anyone).
    await openTab(page, 'alice', sprintId, REEL_WIPE);
    await closeTitleCard(page);
    await cap.say('Each team member sets their own availability.');
    await humanFill(page, page.getByLabel('Available capacity in days for Alice Smith'), '8');
    await page.getByLabel('Available capacity in days for Alice Smith').blur();
    await expect(page.getByLabel('Available capacity in days for Alice Smith')).toHaveValue('8', {
      timeout: 15_000,
    });
    await cap.say('Capacity updates as availability changes.');
    await settle(page, 700);

    // ── 4. Work is added on the board → remaining capacity updates automatically.
    await openTab(page, 'manager', sprintId, REEL_WIPE);
    await closeTitleCard(page);
    const remaining = page
      .locator('dt', { hasText: 'Remaining capacity' })
      .locator('xpath=following-sibling::dd');
    await moveTo(page, remaining);
    await cap.say('Add work on the board, and remaining capacity updates on its own.');
    const remainingBefore = (await remaining.textContent())?.trim();
    await page.evaluate(
      ([id]) =>
        fetch(`/__demo/add-issue?sprintId=${id}&originalMinutes=2400&currentMinutes=2400`, {
          method: 'POST',
        }).then((r) => r.ok),
      [sprintId] as const,
    );
    // No Refresh button — the tab auto-refreshes and the number changes on its own.
    await expect
      .poll(async () => (await remaining.textContent())?.trim(), { timeout: 15_000 })
      .not.toBe(remainingBefore);
    await settle(page, 1100);
    // The native Kanban board is shown in the REAL-YouTrack demo suite (tests/e2e/real-demo);
    // this deterministic suite drives only the app's own widgets, never a stub board.
    await cap.say('Sprint Capacity Planner — plan with confidence, no busywork.');
    await moveTo(page, page.getByText('Remaining capacity', { exact: true }));
    await settle(page, 1400);
    await info.attach('walkthrough-overview.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('01-product-walkthrough');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
