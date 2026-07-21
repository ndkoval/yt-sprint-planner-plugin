import {
  test,
  expect,
  appFrame,
  guardErrors,
  resetDemoState,
  PROJECT_KEY,
  Captioner,
  closeTitleCard,
  primeTitleCard,
  humanClick,
  humanFill,
  moveTo,
  settle,
} from './helpers.js';

/**
 * Reel #1 — install & configure, as ONE continuous recording that starts from the target
 * project. We open the project's own Apps settings (where the Sprint Capacity Planner is
 * attached to this project), open the app, then set it up in one place with real interactions:
 * pick the board and effort fields, type a backlog search, split the project into small teams
 * (Platform + Mobile), add a teammate to a team with the picker, set their part-time
 * allocation, and save.
 */
test.describe('Install & configure', () => {
  test.beforeAll(() => resetDemoState());

  test('add the app to a project and set it up', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // 1. Start in the target project — its Apps settings, where the app is attached.
    const intro = new URLSearchParams({
      tab: 'apps',
      reelIntro: '1',
      reelTitle: 'Sprint Capacity Planner',
      reelSubtitle: 'Add it to your project in minutes',
    });
    // Paint the title card first so the reel's very first frame is the branded card.
    await primeTitleCard(page, 'Sprint Capacity Planner', 'Add it to your project in minutes');
    const nav = page
      .goto(`/projects/${PROJECT_KEY}?${intro.toString()}`, { waitUntil: 'domcontentloaded' })
      .catch(() => null);
    await page.waitForTimeout(500);
    await cap.say('Add the Sprint Capacity Planner to your project — one app, installed from a single ZIP.');
    await nav;
    await page.waitForTimeout(1200);
    await closeTitleCard(page);

    const appRow = page.getByText('Sprint Capacity Planner').first();
    await expect(appRow).toBeVisible();
    await moveTo(page, appRow);
    await cap.say('Here it is — attached to this project and active, with no separate service to run.');
    await settle(page, 1000);

    // 2. Open the app's project tab.
    await cap.say('Open Sprint Capacity right here in the project.');
    await humanClick(page, page.locator('a[href*="tab=sprint-capacity-planner"]').first());
    const frame = await appFrame(page);
    await expect(frame.getByText(/Raw capacity|Not configured yet|Plan work/).first()).toBeVisible();
    await settle(page, 800);

    // 3. Open the embedded Settings.
    await cap.say('Everything is set up in one place — open Settings.');
    await humanClick(page, frame.getByRole('button', { name: /^Settings$/ }));
    const sf = await appFrame(page);
    await expect(sf.getByRole('heading', { name: 'Agile board' })).toBeVisible();

    // 4. Board + effort fields.
    await moveTo(page, sf.getByRole('heading', { name: 'Agile board' }));
    await cap.say('Pick the agile board that holds your Sprints.');
    await settle(page, 700);
    await moveTo(page, sf.getByRole('heading', { name: /Effort field/i }));
    await cap.say('Map your effort fields — planned and remaining.');
    await settle(page, 700);

    // 5. Backlog search — actually type a query.
    await moveTo(page, sf.getByRole('heading', { name: 'Planning backlog' }));
    await cap.say('Define the backlog with any YouTrack search — that’s what you plan from.');
    await humanFill(page, sf.getByLabel('Backlog search query'), `project: ${PROJECT_KEY} State: Open`);
    await settle(page, 900);

    // 6. Teams — a big project plans as SMALL TEAMS; each has its own members.
    await moveTo(page, sf.getByRole('heading', { name: 'Teams' }));
    await cap.say('Big project? Split planning into small teams — here, Platform and Mobile.');
    // Team names live in input VALUES (not text), so target the card by its stable id.
    const mobileCard = sf.locator('[data-test="scp-team-card"][data-team="team-2"]');
    await expect(mobileCard).toBeVisible();
    await settle(page, 700);

    // Add Erin to the Mobile team with the picker, then set a part-time allocation.
    await cap.say('Each team picks its own members — add Erin to Mobile.');
    await humanClick(page, mobileCard.getByRole('combobox', { name: 'Add a team member…' }));
    await settle(page, 500);
    await humanFill(page, sf.getByRole('textbox', { name: 'Filter items' }), 'Erin');
    await settle(page, 800);
    await humanClick(page, sf.getByRole('button', { name: /Erin Park/ }).first());
    await settle(page, 700);
    await cap.say('Set a part-time allocation and their capacity scales to match — Erin at sixty percent.');
    await humanFill(page, sf.getByLabel(/Allocation for Erin Park/i), '60');
    await settle(page, 900);

    // 7. Creating a whole new team is one click + a name.
    await cap.say('Need another squad? Add a team and name it.');
    await humanClick(page, sf.getByRole('button', { name: 'Add team', exact: true }));
    const newCard = sf.locator('[data-test="scp-team-card"]').nth(2);
    await expect(newCard).toBeVisible();
    await humanFill(page, newCard.getByLabel('Team name'), 'Design');
    await settle(page, 800);

    // 8. Save.
    await cap.say('Save — and every team is ready to plan.');
    await humanClick(page, sf.getByRole('button', { name: 'Save settings' }));
    await expect(sf.getByText('Settings saved.')).toBeVisible();
    await settle(page, 1500);

    await info.attach('setup.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('01-setup');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
