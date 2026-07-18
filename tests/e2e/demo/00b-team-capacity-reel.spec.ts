import {
  test,
  expect,
  openTab,
  guardErrors,
  humanClick,
  humanFill,
  moveTo,
  settle,
  Captioner,
  showTitleCard,
} from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * Marketing reel #2 — "plan capacity with your whole team". A focused, subtitled story:
 * a manager creates the next Sprint, then each teammate sets their own availability (no
 * confirmation step — that was removed as redundant), and raw + planned capacity update
 * live. Ends on the manager's view. Distinct from reel #1 (the broad end-to-end
 * walkthrough); this one showcases the collaborative availability workflow.
 */
test.describe('Marketing reel — team capacity', () => {
  test('the whole team sets availability for the next Sprint', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // Manager creates the next Sprint.
    await openTab(page, 'manager', 'sprint-2');
    await showTitleCard(page, 'Plan capacity with your team', 'Everyone sets their own availability');
    await cap.say('Plan a Sprint with your whole team');
    await humanClick(page, page.getByRole('button', { name: 'Create next Sprint' }));
    await expect(page.getByText('AppGlass 2026-S3')).toBeVisible();
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

    // Alice sets availability + a note.
    await openTab(page, 'alice', sprintId);
    await cap.say('Alice adjusts her availability and adds a note');
    await humanFill(page, page.getByLabel('Available capacity in days for Alice Smith'), '7');
    await page.getByLabel('Available capacity in days for Alice Smith').blur();
    await humanFill(page, page.getByLabel('Note for Alice Smith'), 'Conference Mon-Tue');
    await page.getByLabel('Note for Alice Smith').blur();
    await cap.say('She can only edit her own row');
    await expect(page.getByLabel('Available capacity in days for Alice Smith')).toHaveValue('7', {
      timeout: 15_000,
    });
    await settle(page, 900);

    // Bob sets his availability too.
    await openTab(page, 'bob', sprintId);
    await cap.say('Bob sets his availability');
    await humanFill(page, page.getByLabel('Available capacity in days for Bob Jones'), '9');
    await page.getByLabel('Available capacity in days for Bob Jones').blur();
    await expect(page.getByLabel('Available capacity in days for Bob Jones')).toHaveValue('9', {
      timeout: 15_000,
    });
    await settle(page, 900);

    // Manager sees the team's capacity roll up.
    await openTab(page, 'manager', sprintId);
    await cap.say('Raw and planned capacity reflect the whole team — automatically');
    await moveTo(page, page.getByText('Planned capacity', { exact: true }));
    await expect(page.getByText('Alice Smith')).toBeVisible();
    await cap.say('Sprint Capacity Planner — the team plans together');
    await settle(page, 1600);
    await info.attach('team-capacity.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('02-team-capacity');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
