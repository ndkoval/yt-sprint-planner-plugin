import {
  test,
  expect,
  openTab,
  guardErrors,
  assertAccessible,
  humanClick,
  humanFill,
  toggleConfirm,
  moveTo,
  settle,
  Captioner,
} from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * Marketing reel #1 — the comprehensive product walkthrough. One continuous, deterministic,
 * subtitled journey through the whole value story, paced and cursored like a real person:
 * see a Sprint's capacity & effort, create the next Sprint in one click, have a team member
 * set and confirm availability, watch remaining capacity update automatically as work is
 * added, and open the board to see the issues. Recorded end-to-end as one 720p video with
 * on-screen captions + a WebVTT subtitle track.
 */
test.describe('Marketing reel — product walkthrough', () => {
  test('plan a Sprint end to end', async ({ page, context }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // ── 1. The planner on the active Sprint: capacity, effort, remaining, data health.
    await openTab(page, 'manager', 'sprint-2');
    await cap.say('Sprint Capacity Planner — capacity planning on top of native YouTrack Sprints');
    await expect(page.getByText('Deliver a usable first customer deployment')).toBeVisible();
    await moveTo(page, page.getByText('Raw capacity'));
    await cap.say('See raw, planned and remaining capacity for the active Sprint at a glance');
    await expect(page.getByText('Remaining capacity', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Data health' })).toBeVisible();
    await assertAccessible(page, info, 'walkthrough-overview');
    await settle(page, 1100);

    // ── 2. Create the next Sprint in one click — name, dates and focus factor computed.
    await cap.say('Create the next Sprint in one click');
    await humanClick(page, page.getByRole('button', { name: 'Create next Sprint' }));
    await expect(page.getByText('AppGlass 2026-S3')).toBeVisible();
    await cap.say('Name, dates and focus factor are computed automatically');
    await expect(page.getByText('2026-07-20')).toBeVisible();
    await humanFill(
      page,
      page.getByLabel('Goal (optional)', { exact: true }),
      'Deepen reporting and polish onboarding',
    );
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
    await openTab(page, 'alice', sprintId);
    await cap.say('Each team member sets their own availability…');
    await humanFill(page, page.getByLabel('Available capacity in days for Alice Smith'), '8');
    await page.getByLabel('Available capacity in days for Alice Smith').blur();
    await expect(page.getByLabel('Available capacity in days for Alice Smith')).toHaveValue('8', {
      timeout: 15_000,
    });
    await cap.say('…and confirms it. Confirmation is informational — it never blocks the team');
    await toggleConfirm(page, 'Alice Smith');
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 15_000 });
    await settle(page, 1000);

    // ── 4. Work is added on the board → remaining capacity updates automatically.
    await openTab(page, 'manager', sprintId);
    const remaining = page
      .locator('dt', { hasText: 'Remaining capacity' })
      .locator('xpath=following-sibling::dd');
    await moveTo(page, remaining);
    await cap.say('As work is estimated on the board, remaining capacity updates automatically');
    const remainingBefore = (await remaining.textContent())?.trim();
    await page.evaluate(
      ([id]) =>
        fetch(`/__demo/add-issue?sprintId=${id}&originalMinutes=2400&currentMinutes=2400`, {
          method: 'POST',
        }).then((r) => r.ok),
      [sprintId] as const,
    );
    await humanClick(page, page.getByRole('button', { name: 'Refresh' }));
    await expect.poll(async () => (await remaining.textContent())?.trim()).not.toBe(remainingBefore);
    await settle(page, 1100);

    // ── 5. Open the board to see the issues behind the numbers.
    const [board] = await Promise.all([
      context.waitForEvent('page'),
      humanClick(page, page.getByRole('button', { name: 'Open board' })),
    ]);
    await board.waitForLoadState('networkidle');
    await expect(board.getByRole('heading', { name: 'AppGlass Board' })).toBeVisible();
    await page.goto('/agiles/board-demo?as=manager', { waitUntil: 'networkidle' });
    await cap.say('The native board is the single source of truth for the issues');
    await expect(page.getByRole('heading', { name: 'AppGlass Board' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'AG-10', exact: true })).toBeVisible();
    await moveTo(page, page.getByRole('cell', { name: 'AG-10', exact: true }));
    await cap.say('Sprint Capacity Planner — plan with confidence, no busywork');
    await settle(page, 1600);
    await info.attach('walkthrough-board.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('01-product-walkthrough');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
