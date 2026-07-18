import {
  test,
  expect,
  openSettings,
  guardErrors,
  humanClick,
  humanFill,
  moveTo,
  settle,
  Captioner,
  closeTitleCard,
} from './helpers.js';

/**
 * Marketing reel #3 — team configuration. A subtitled, cursored walk through the Sprint
 * Capacity Settings: pick the board, map effort fields, set the schedule + naming, build
 * the team, and save. This is the whole one‑time setup.
 */
test.describe('Marketing reel — team configuration', () => {
  test('configure the board, effort fields, schedule, naming and team', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    await openSettings(page, 'manager', {
      title: 'Configure in a minute',
      subtitle: 'Board · effort fields · schedule · team',
    });
    await cap.say('Set up Sprint Capacity Planner once.');
    await closeTitleCard(page);
    await expect(page.getByRole('heading', { name: 'Agile board' })).toBeVisible();
    await moveTo(page, page.getByRole('heading', { name: 'Agile board' }));
    await cap.say('Pick your agile board.');

    await moveTo(page, page.getByRole('heading', { name: 'Effort field mapping' }));
    await cap.say('Map your original and current effort fields.');

    await moveTo(page, page.getByRole('heading', { name: 'Schedule' }));
    await cap.say('Set the schedule and naming template.');
    await humanFill(page, page.getByLabel(/Naming template/), 'AppGlass {year}-S{sequence}');

    await moveTo(page, page.getByRole('heading', { name: 'Team' }));
    await cap.say('Build your team.');
    await humanFill(page, page.getByLabel('Add participant by user id'), '1-4');
    await humanClick(page, page.getByRole('button', { name: 'Add', exact: true }));

    await cap.say('Save, and you’re ready to plan.');
    await humanClick(page, page.getByRole('button', { name: 'Save settings' }));
    await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 15_000 });
    await cap.say('Configured in a minute.');
    await settle(page, 1200);
    await info.attach('team-configuration.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('03-team-configuration');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
