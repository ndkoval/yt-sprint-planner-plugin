import {
  test,
  expect,
  openProjectApp,
  appFrame,
  guardErrors,
  Captioner,
  closeTitleCard,
  moveTo,
  humanClick,
  settle,
} from './helpers.js';

/**
 * Marketing reel #4 (REAL YouTrack): the native Kanban board. The planner sits on top of
 * YouTrack's real Sprints, so "Open board" jumps to the actual native agile board with the
 * Sprint's issues — no custom board, the real thing.
 */
test.describe('Real YouTrack — native board', () => {
  test('jump from the planner to the real native Kanban board', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    const frame = await openProjectApp(page, 'Sprint Capacity', {
      reel: { title: 'On top of native Sprints', subtitle: 'The real YouTrack Kanban board' },
      cap,
      intro: 'The planner sits on top of YouTrack’s native Sprints.',
    });
    await closeTitleCard(page);
    await expect(frame.getByText('Raw capacity')).toBeVisible();
    await cap.say('Plan capacity here, then open the real board.');
    await moveTo(page, (await appFrame(page)).getByRole('button', { name: 'Open board' }));
    await settle(page, 600);

    // Open the real native agile board via the project's own "Agile Boards" link.
    await cap.say('This is YouTrack’s own Kanban board — not a custom one.');
    await humanClick(page, page.getByText('Agile Boards', { exact: true }).first());
    await page.waitForTimeout(6500);
    await expect(page.getByText(/In Progress|Open|Fixed|Verified/i).first()).toBeVisible();
    await settle(page, 800);

    // Switch to the Sprint that holds the seeded issues (S1) so the board shows real cards.
    const sprintSel = page.getByText(/AppGlass \d{4}-S\d+/).first();
    if (await sprintSel.count()) {
      await humanClick(page, sprintSel);
      await page.waitForTimeout(800);
      const s1 = page.getByText(/AppGlass \d{4}-S1\b/).first();
      if (await s1.count()) await humanClick(page, s1);
      await page.waitForTimeout(4000);
    }
    await cap.say('The Sprint’s issues live on the native board, the single source of truth.');
    await settle(page, 1600);

    await info.attach('native-board.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('04-real-board');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
