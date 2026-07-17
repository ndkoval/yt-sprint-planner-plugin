import {
  test,
  expect,
  openTab,
  guardErrors,
  humanClick,
  humanFill,
  toggleConfirm,
  moveTo,
  settle,
  Captioner,
} from './helpers.js';

const API = '/api/apps/sprint-capacity-planner/backend';

/**
 * Marketing reel #2 — "plan capacity with your whole team". A focused, subtitled story:
 * a manager creates the next Sprint, then each teammate sets their own availability and
 * confirms it, and the confirmation count + confirmed capacity fill up live. Ends on the
 * manager's view with everyone confirmed and planned capacity ready. Distinct from reel #1
 * (which is the broad end-to-end walkthrough); this one showcases the collaborative
 * availability workflow.
 */
test.describe('Marketing reel — team capacity', () => {
  test('the whole team confirms availability for the next Sprint', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // Manager creates the next Sprint.
    await openTab(page, 'manager', 'sprint-2');
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

    await openTab(page, 'manager', sprintId);
    await cap.say('A fresh Sprint starts with nobody confirmed — 0 of 3');
    await moveTo(page, page.getByText('Participants confirmed', { exact: true }));
    await expect(page.getByText('0/3')).toBeVisible();
    await settle(page, 1000);

    // Alice sets availability + a note, then confirms.
    await openTab(page, 'alice', sprintId);
    await cap.say('Alice adjusts her availability and adds a note');
    await humanFill(page, page.getByLabel('Available capacity in days for Alice Smith'), '7');
    await page.getByLabel('Available capacity in days for Alice Smith').blur();
    await humanFill(page, page.getByLabel('Note for Alice Smith'), 'Conference Mon-Tue');
    await page.getByLabel('Note for Alice Smith').blur();
    await cap.say('…then confirms — she can only edit her own row');
    await toggleConfirm(page, 'Alice Smith');
    await expect(page.getByText('1/3')).toBeVisible({ timeout: 15_000 });
    await settle(page, 900);

    // Bob confirms.
    await openTab(page, 'bob', sprintId);
    await cap.say('Bob confirms his availability');
    await toggleConfirm(page, 'Bob Jones');
    await expect(page.getByText('2/3')).toBeVisible({ timeout: 15_000 });
    await settle(page, 800);

    // Charlie confirms.
    await openTab(page, 'charlie', sprintId);
    await cap.say('Charlie confirms too');
    await toggleConfirm(page, 'Charlie Diaz');
    await expect(page.getByText('3/3')).toBeVisible({ timeout: 15_000 });
    await settle(page, 800);

    // Manager sees everyone confirmed + planned capacity.
    await openTab(page, 'manager', sprintId);
    await cap.say('Everyone confirmed — planned capacity is ready');
    await moveTo(page, page.getByText('Planned capacity', { exact: true }));
    await expect(page.getByText('3/3')).toBeVisible();
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
