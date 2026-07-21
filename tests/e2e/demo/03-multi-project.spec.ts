import {
  test,
  expect,
  openProjectApp,
  appFrame,
  guardErrors,
  resetDemoState,
  SECOND_PROJECT_KEY,
  Captioner,
  closeTitleCard,
  primeTitleCard,
  humanClick,
  moveTo,
  settle,
} from './helpers.js';

/**
 * Reel #3 — per-project independence. Two REAL projects live side by side on the same
 * YouTrack: AppGlass (two teams, two-week Sprints, 8-hour days) and Orbit CRM (one small
 * team, one-week Sprints, 6-hour days, its own board and naming). The reel walks from one
 * planner to the other and into Orbit's settings, showing that every knob is project-local.
 */
test.describe('Multiple projects', () => {
  test.beforeAll(() => resetDemoState());

  test('two projects, configured independently', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // 1. Start in the flagship project's planner.
    await primeTitleCard(page, 'Sprint Capacity Planner', 'Every project planned independently');
    const agp = await openProjectApp(page, 'Sprint Capacity', {
      reel: { title: 'Sprint Capacity Planner', subtitle: 'Every project planned independently' },
      cap,
      intro: 'Planning more than one project? Each one is configured on its own.',
    });
    await closeTitleCard(page);

    await expect(agp.getByText('Raw capacity')).toBeVisible();
    await cap.say('AppGlass runs two-week Sprints with two teams — Platform and Mobile.');
    await moveTo(page, agp.locator('[data-test="scp-team-select"]'));
    await settle(page, 900);
    await moveTo(page, agp.getByText(/AppGlass \d{4}-S\d+/).first());
    await settle(page, 900);

    // 2. Jump to the second project — a completely different setup.
    await cap.say('Orbit CRM is a different world — one small team, one-week Sprints, six-hour days.');
    const orb = await openProjectApp(page, 'Sprint Capacity', { projectKey: SECOND_PROJECT_KEY });
    await expect(orb.getByText('Raw capacity')).toBeVisible();
    await moveTo(page, orb.getByText(/Orbit \d{4}-S\d+/).first());
    await settle(page, 1000);
    await cap.say('Its own board, its own sprint names, its own team — nothing is shared.');
    await moveTo(page, orb.getByText('Raw capacity').first());
    await settle(page, 900);

    // 3. Peek into Orbit's settings: every knob is project-local.
    await cap.say('All of it lives in the project settings — schedule, backlog, teams, even reminders.');
    await humanClick(page, orb.getByRole('button', { name: /^Settings$/ }));
    const sf = await appFrame(page);
    await expect(sf.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await moveTo(page, sf.getByRole('heading', { name: 'Schedule' }));
    await expect(sf.getByLabel(/Sprint length/i)).toHaveValue('7');
    await settle(page, 900);
    await cap.say('Change a project here — every other project stays exactly as its managers set it.');
    await moveTo(page, sf.getByRole('button', { name: 'Save settings' }));
    await settle(page, 1000);

    await cap.say('Sprint Capacity Planner — configure each project once, plan them all with confidence.');
    await settle(page, 1400);
    await info.attach('multi-project.png', { body: await page.screenshot(), contentType: 'image/png' });

    const vtt = await cap.writeVtt('03-multi-project');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
