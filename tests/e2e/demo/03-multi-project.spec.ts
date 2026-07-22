import {
  test,
  expect,
  openProjectApp,
  appFrame,
  guardErrors,
  resetDemoState,
  PROJECT_KEY,
  SECOND_PROJECT_KEY,
  Captioner,
  closeTitleCard,
  primeTitleCard,
  dragCard,
  humanClick,
  humanFill,
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
    // Show the evidence WHILE the line plays: open the team selector so both teams
    // are literally on screen.
    await humanClick(page, agp.getByRole('combobox', { name: 'Select a team' }));
    const teamPopup = agp.locator('[data-test="ring-popup"]');
    await expect(teamPopup).toContainText('Mobile');
    await cap.say('AppGlass plans as two independent teams — Platform on two-week Sprints, Mobile on one-week ones, each on its own board.');
    await settle(page, 700);
    await page.keyboard.press('Escape');
    await moveTo(page, agp.getByText('Capacity — Platform', { exact: true }));
    await settle(page, 600);
    await moveTo(page, agp.getByText(/Platform \d{4}-S\d+/).first());
    await settle(page, 900);

    // 2. Jump to the second project — navigate FIRST, describe once Orbit is visible.
    await cap.say('Now hop to a second project.');
    const orb = await openProjectApp(page, 'Sprint Capacity', { projectKey: SECOND_PROJECT_KEY });
    await expect(orb.getByText('Raw capacity')).toBeVisible();
    await moveTo(page, orb.getByText(/Orbit \d{4}-S\d+/).first());
    await cap.say('Orbit CRM is a different world — one small team on one-week Sprints.');
    await settle(page, 800);
    await cap.say('Its own board, its own sprint names, its own team — nothing is shared.');
    await moveTo(page, orb.getByText('Raw capacity').first());
    await settle(page, 900);

    // NEW: Orbit ALSO tracks Sprints in an enum FIELD — plan work and watch the
    // field follow the move automatically.
    await cap.say('One more thing: Orbit also tracks Sprints in a field. Pull work in — backlog onto Unassigned…');
    await dragCard(
      page,
      orb,
      orb.locator('[title*="Webhook API"]').first(),
      orb.getByLabel(/^Lane Unassigned/).first(),
    );
    await expect(orb.getByLabel(/^Lane Unassigned/).locator('[title*="Webhook API"]')).toBeVisible();
    await settle(page, 700);
    const fieldCard = orb.locator('[data-test="scp-card"]', { hasText: 'Webhook API' }).first();
    await moveTo(page, fieldCard);
    await fieldCard.dblclick();
    const overlay = orb.locator('[data-test="scp-issue-overlay"]');
    await expect(overlay).toBeVisible();
    const sprintField = overlay.locator('[data-field="Sprint"]');
    await expect(sprintField).toContainText(/Orbit \d{4}-S1/, { timeout: 20_000 });
    await moveTo(page, sprintField);
    await cap.say('…and the Sprint field is set for you — every planning move keeps it in sync automatically.');
    await settle(page, 1100);
    await overlay.locator('[data-test="scp-issue-overlay-close"]').click();
    await expect(overlay).toBeHidden();
    await settle(page, 500);

    // 3. Orbit's settings: every knob belongs to the team — and prove the isolation
    // with a REAL edit: bump Erin's allocation, save, then show AppGlass untouched.
    // Click FIRST so the settings page is on screen while the line describes it.
    await humanClick(page, orb.getByRole('button', { name: /^Settings$/ }));
    await cap.say('All of it lives with the team in its project settings — board, schedule, backlog, even reminders.');
    const sf = await appFrame(page);
    await expect(sf.getByText('Schedule', { exact: true })).toBeVisible();
    await moveTo(page, sf.getByLabel(/Hours per day/i));
    await expect(sf.getByLabel(/Sprint length/i)).toHaveValue('7');
    await cap.say('Seven-day Sprints, six-hour days — Orbit’s own schedule.');
    await settle(page, 700);
    await cap.say('Watch a real change: Erin drops to eighty percent — and save.');
    await humanFill(page, sf.getByLabel(/Allocation for Erin Park/i), '80');
    await humanClick(page, sf.getByRole('button', { name: 'Save settings' }));
    await expect(sf.getByText('Settings saved.')).toBeVisible();
    await settle(page, 900);

    // Back to AppGlass — deep-link STRAIGHT to the planner tab (no confusing hop
    // through the Apps admin list mid-claim).
    await page.goto(`/projects/${PROJECT_KEY}?tab=sprint-capacity-planner%3ASprint+Capacity`, {
      waitUntil: 'domcontentloaded',
    });
    const agpAgain = await appFrame(page);
    await expect(agpAgain.getByText('Capacity — Platform', { exact: true })).toBeVisible();
    await moveTo(page, agpAgain.getByText('Capacity — Platform', { exact: true }));
    await cap.say('And AppGlass? Exactly as its managers left it — every team, every project, fully isolated.');
    await settle(page, 900);

    await cap.say('Sprint Capacity Planner — configure each project once, plan them all with confidence.');
    await settle(page, 900);
    await info.attach('multi-project.png', { body: await page.screenshot(), contentType: 'image/png' });

    const vtt = await cap.writeVtt('03-multi-project');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
