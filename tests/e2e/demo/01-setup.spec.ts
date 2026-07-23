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
 * attached to this project), open the app, then set it up in one place with real
 * interactions. Since config v4 EVERY setting belongs to a team: each team card owns its
 * board, effort fields, cadence and backlog — we tour Platform's card, type its backlog
 * search, add a teammate to Mobile with the picker, set a part-time allocation, create a
 * whole new team, and save.
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
    // Short: narration must start within ~1.2s of the first frame (QA lead-silence bar).
    await page.waitForTimeout(250);
    await cap.say('The Sprint Capacity Planner — one app from a single ZIP, already installed and attached to this project.');
    await nav;
    await page.waitForTimeout(1200);
    await closeTitleCard(page);

    const appRow = page.getByText('Sprint Capacity Planner').first();
    await expect(appRow).toBeVisible();
    await moveTo(page, appRow);
    await cap.say('Here it is — active, with no separate service to run.');
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
    await expect(sf.getByRole('heading', { name: 'Teams' })).toBeVisible();

    // 4. Teams first: a big project plans as SMALL TEAMS, and every setting is theirs.
    await moveTo(page, sf.getByRole('heading', { name: 'Teams' }));
    await cap.say('Big project? Split planning into small, fully independent teams.');
    // Team names live in input VALUES (not text), so target the card by its stable id.
    const platformCard = sf.locator('[data-test="scp-team-card"][data-team="team-1"]');
    const mobileCard = sf.locator('[data-test="scp-team-card"][data-team="team-2"]');
    await expect(mobileCard).toBeVisible();
    await settle(page, 700);

    // 5. Each team owns its ENTIRE configuration — anchor on the card's name FIRST,
    // then tour the scoped headers ("Agile board — Platform") so it is always clear
    // WHOSE setting is being shown or edited, and so the narrated value ("two-week")
    // is actually IN FRAME while the words play.
    await moveTo(page, platformCard.getByLabel('Team name'));
    await cap.say('This card is Platform’s — and every block inside is labeled with the team it belongs to.');
    await settle(page, 700);
    await moveTo(page, platformCard.getByText('Agile board — Platform', { exact: true }));
    await cap.say('Platform’s own board and effort fields…');
    await settle(page, 700);
    // Cursor ON the actual field while its value is narrated (the tall auto-height
    // iframe defeats viewport assertions — moveTo scrolls the evidence into frame).
    await moveTo(page, platformCard.getByLabel(/Sprint length/i));
    await cap.say('…and Platform’s own schedule — fourteen-day Sprints, right here.');
    await settle(page, 800);
    await moveTo(page, mobileCard.getByLabel(/Sprint length/i));
    await cap.say('Mobile — see its label — runs seven-day Sprints on its own board. Completely independent.');
    await settle(page, 800);

    // 6. …and its own backlog — CLEAR the field first, then type Platform's query in
    // full view, so the viewer sees exactly what goes in.
    await moveTo(page, platformCard.getByText('Planning backlog — Platform', { exact: true }));
    await cap.say('Each team plans from its own backlog. This one is Platform’s — let’s type its query from scratch.');
    await platformCard.getByLabel('Backlog search query').fill('');
    await settle(page, 400);
    await humanFill(
      page,
      platformCard.getByLabel('Backlog search query'),
      `project: ${PROJECT_KEY} State: Open Priority: Normal`,
    );
    await settle(page, 900);

    // 7. Add Erin to the Mobile team with the picker, then set a part-time
    // allocation — anchored on Mobile's card and its scoped Members header.
    await moveTo(page, mobileCard.getByLabel('Team name'));
    await cap.say('Now Mobile’s card.');
    await settle(page, 500);
    await moveTo(page, mobileCard.getByText('Members — Mobile', { exact: true }));
    await cap.say('Each team picks its own members — open the picker under Mobile.');
    await humanClick(page, mobileCard.getByRole('combobox', { name: 'Add a team member…' }));
    await settle(page, 400);
    await humanFill(page, sf.getByRole('textbox', { name: 'Filter items' }), 'Erin');
    // Narrate ACROSS the option-appear + click so there is never a silent static
    // stretch even if the user-directory search is slow in the recorder.
    const pickLine = cap.say('Find Erin in the directory and add her.');
    await sf.getByRole('button', { name: /Erin Park/ }).first().click();
    await pickLine;
    await settle(page, 400);
    // Speak WHILE the edit happens so "sixty percent" lands as the 60 appears
    // (saying first left the field showing 100 for the whole caption).
    const allocationLine = cap.say(
      'Set a part-time allocation and their capacity scales to match — Erin at sixty percent.',
    );
    await humanFill(page, sf.getByLabel(/Allocation for Erin Park/i), '60');
    await allocationLine;
    await settle(page, 900);

    // 8. Creating a whole new team is one click + a name (it starts from the first
    // team's settings, ready to save — every field can then diverge independently).
    await cap.say('Need another squad? Add a team and name it — it starts ready to plan, and every setting can diverge later.');
    await humanClick(page, sf.getByRole('button', { name: 'Add team', exact: true }));
    const newCard = sf.locator('[data-test="scp-team-card"]').nth(2);
    await expect(newCard).toBeVisible();
    await humanFill(page, newCard.getByLabel('Team name'), 'Design');
    // The scoped headers relabel themselves live as the name is typed. Anchor on a
    // LOWER header so "Agile board — Design" sits above the caption zone (the
    // caption box must never cover the very evidence being narrated).
    await moveTo(page, newCard.getByText('Schedule — Design', { exact: true }));
    await expect(newCard.getByText('Agile board — Design', { exact: true })).toBeVisible();
    await cap.say('And every block instantly labels itself as Design’s.');
    await settle(page, 800);

    // 9. Save.
    await cap.say('Save — and every team is ready to plan.');
    await humanClick(page, sf.getByRole('button', { name: 'Save settings' }));
    await expect(sf.getByText('Settings saved.')).toBeVisible();
    await settle(page, 800);

    await info.attach('setup.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('01-setup');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
