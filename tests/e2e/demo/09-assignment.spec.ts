import {
  test,
  expect,
  openTab,
  guardErrors,
  assertAccessible,
  moveTo,
  settle,
  Captioner,
  showTitleCard,
} from './helpers.js';

/**
 * Marketing reel #5 — per-person planning. Assigning tasks to people while planning, with an
 * Unassigned bucket. The capacity table shows each person's assigned load and a
 * "Load (committed / capacity)" bar (committed Original Effort vs their available days, red when
 * over), the capacity summary shows the Sprint-level "what fits" banner, and the effort summary
 * shows the unassigned remainder — so you can balance the team while still leaving work owned by
 * project direction, not forced onto a person. Everything updates automatically as issues change.
 * Recorded end-to-end as one 720p video with a title card, on-screen captions + a WebVTT track.
 */
test.describe('Marketing reel — per-person planning', () => {
  test('assigned load per person + unassigned bucket, updating automatically', async ({
    page,
  }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    await openTab(page, 'manager', 'sprint-2');
    await showTitleCard(page, 'Plan per person', 'Balance the team, keep work owned by direction');
    await cap.say('Assign tasks to people while planning — and leave some work unassigned on purpose');

    const assignedCell = (name: string) =>
      page.locator('tr', { hasText: name }).locator('td').nth(3);
    const loadCell = (name: string) =>
      page.locator('tr', { hasText: name }).locator('td').nth(4);
    const unassigned = page
      .locator('dt', { hasText: 'Unassigned' })
      .locator('xpath=following-sibling::dd');

    // ── 1. Each person's assigned load, next to their available capacity.
    await moveTo(page, page.getByRole('columnheader', { name: 'Assigned' }));
    await cap.say('Each person shows the load assigned to them');
    // Seeded: Alice AG-10 (5d current), Bob AG-12 (3.75d), AG-13 (1.25d) unassigned.
    await expect(assignedCell('Alice Smith')).toHaveText('5');
    await expect(assignedCell('Bob Jones')).toHaveText('3.75');
    await expect(assignedCell('Charlie Diaz')).toHaveText('0');
    await settle(page, 900);

    // ── 2. The Load bar: committed Original Effort vs available capacity, red when over.
    await moveTo(page, page.getByRole('columnheader', { name: 'Load (committed / capacity)' }));
    await cap.say('The Load bar compares committed work to each person’s capacity — over-commitment turns red');
    await expect(loadCell('Alice Smith')).toContainText('15/8');
    await expect(loadCell('Alice Smith')).toContainText('⚠ over');
    await expect(loadCell('Charlie Diaz')).toContainText('0/');
    await settle(page, 900);

    // ── 3. The Unassigned bucket preserves project-direction ownership.
    await moveTo(page, unassigned);
    await cap.say('Work left unassigned stays owned by project direction, not forced onto a person');
    // The summary metric rounds to one decimal (1.25d → "1.3d"); table cells show 2 decimals.
    await expect(unassigned).toHaveText('1.3d');
    await settle(page, 800);

    // ── 4. The Sprint-level "what fits" banner.
    const fitBanner = page.getByRole('status').filter({ hasText: 'Committed' });
    await moveTo(page, fitBanner);
    await cap.say('And the "what fits" banner shows whether the whole Sprint plan fits its capacity');
    await expect(fitBanner).toContainText('vs planned');
    await assertAccessible(page, info, 'assignment-overview');
    await settle(page, 900);

    // ── 5. Plan more work: assign a task to Charlie and add one that stays unassigned.
    await cap.say('Plan more work — assign a task to Charlie, and add one that stays unassigned');
    await page.evaluate(async () => {
      await fetch('/__demo/add-issue?sprintId=sprint-2&originalMinutes=1440&currentMinutes=1440&assigneeId=1-3', { method: 'POST' });
      await fetch('/__demo/add-issue?sprintId=sprint-2&originalMinutes=480&currentMinutes=480', { method: 'POST' });
    });
    // Charlie now carries 3d; the unassigned bucket grew by 1d — reflected automatically
    // by auto-refresh (no button to click).
    await moveTo(page, assignedCell('Charlie Diaz'));
    await cap.say('Everything recalculates automatically — no refresh, no recalculate button');
    await expect(assignedCell('Charlie Diaz')).toHaveText('3', { timeout: 15_000 });
    await expect(unassigned).toHaveText('2.3d');
    await settle(page, 1200);

    await info.attach('assignment.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('05-per-person-planning');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
