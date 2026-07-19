import {
  test,
  expect,
  openProjectApp,
  guardErrors,
  Captioner,
  closeTitleCard,
  moveTo,
  settle,
} from './helpers.js';

/**
 * Marketing reel #3 (REAL YouTrack): configuration. Walks the Sprint Capacity Settings
 * widget inside a real YouTrack project — board, effort field mapping, schedule/naming and
 * the team — the one-time setup.
 */
test.describe('Real YouTrack — configuration', () => {
  test('the Sprint Capacity Settings on a real instance', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    const frame = await openProjectApp(page, 'Sprint Capacity Settings', {
      reel: { title: 'Configure in a minute', subtitle: 'Board · effort fields · schedule · team' },
      cap,
      intro: 'Set up Sprint Capacity Planner once, in project settings.',
    });
    await closeTitleCard(page);

    await expect(frame.getByRole('heading', { name: 'Agile board' })).toBeVisible();
    await moveTo(page, frame.getByRole('heading', { name: 'Agile board' }));
    await cap.say('Pick the agile board with your Sprints.');
    await settle(page, 700);

    await moveTo(page, frame.getByRole('heading', { name: /Effort field/i }));
    await cap.say('Map your original and current effort fields.');
    await settle(page, 700);

    await moveTo(page, frame.getByRole('heading', { name: 'Schedule' }));
    await cap.say('Set the schedule and the Sprint naming template.');
    await settle(page, 700);

    await moveTo(page, frame.getByRole('heading', { name: 'Team' }));
    await cap.say('Choose the team whose capacity you plan.');
    await settle(page, 900);

    await cap.say('Configured — and ready to plan, on real YouTrack.');
    await settle(page, 1300);

    await info.attach('settings.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('03-real-settings');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
