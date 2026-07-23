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
  moveTo,
  settle,
} from './helpers.js';

/**
 * Reel #4 — launch the planner from an ISSUE. Board cards and issue links live all
 * over YouTrack, so the app adds a "Sprint Planner" item to every issue's ⋯ options
 * menu. Opening it pops the planner in a dialog over the issue, already scoped to the
 * issue's project and its ACTIVE Sprint — no navigating to settings. This reel opens
 * a real AppGlass issue, opens the menu, and shows the planner load in place.
 */
test.describe('Launch from an issue', () => {
  test.beforeAll(() => resetDemoState());

  test('open Sprint Planner from an issue’s options menu', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // Paint the branded card as the VERY FIRST action so the first frame is the card
    // (not a white about:blank while the API call below runs — that added lead silence).
    await primeTitleCard(page, 'Sprint Capacity Planner', 'Open it from any issue');

    // Resolve a real AppGlass issue to open (the seed recreates ids each run). Use
    // the admin token (the recorder forwards YT_TEST_ADMIN_TOKEN) — cookie auth
    // isn't honoured for /api in the headless recorder context.
    const token = process.env.YT_TEST_ADMIN_TOKEN ?? '';
    const res = await page.request.get(
      `/api/issues?query=project:%20${PROJECT_KEY}&fields=idReadable,summary&$top=1`,
      { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    );
    const body = (await res.json()) as unknown;
    const first = Array.isArray(body) ? (body[0] as { idReadable?: string; summary?: string }) : undefined;
    expect(first?.idReadable, 'a seeded AppGlass issue').toBeTruthy();
    const issue = { idReadable: first!.idReadable!, summary: first!.summary ?? '' };

    // The init script repaints the card in the new document via ?reelIntro. AWAIT the
    // navigation before narrating — a page.evaluate (cap.say) issued mid-navigation
    // dies with "execution context destroyed".
    await page
      .goto(`/issue/${issue.idReadable}?reelIntro=1&reelTitle=${encodeURIComponent('Sprint Capacity Planner')}&reelSubtitle=${encodeURIComponent('Open it from any issue')}`, {
        waitUntil: 'domcontentloaded',
      })
      .catch(() => null);
    await cap.say('Working in an issue? Open the Sprint Capacity Planner without leaving it.');
    await page.waitForTimeout(600);
    await closeTitleCard(page);

    // The issue is on screen.
    await expect(page.getByText(issue.summary, { exact: false }).first()).toBeVisible();
    await cap.say(`This is ${issue.idReadable} in AppGlass — open its options menu.`);
    // The issue toolbar's ⋯ button (aria-label contains "more").
    await humanClick(page, page.locator('button[aria-label*="more" i]').first());
    await settle(page, 700);

    // The app added "Sprint Planner" to the menu — point at it and open it.
    const item = page.getByText('Sprint Planner', { exact: true }).last();
    await item.scrollIntoViewIfNeeded();
    await moveTo(page, item);
    await cap.say('The app adds "Sprint Planner" right here — one click.');
    await item.click();

    // The planner opens in a dialog, already scoped to the issue's project.
    const frame = await appFrame(page);
    await expect(frame.locator('[data-test="scp-ready"]')).toBeVisible({ timeout: 30_000 });
    await cap.say('It opens in place — scoped to this issue’s project, on the active Sprint.');
    await settle(page, 900);

    // Show the live capacity for the team, in the dialog. Anchor on the section
    // header, SCROLL the whole roster into frame (Platform is Nikita + Alice +
    // half-time Bob — so "team's capacity" shows several teammates, not just the
    // first row), then CLEAR the caption and hold so those data rows sit
    // unobstructed above the (now empty) subtitle band — the review flagged that
    // the caption bar otherwise covers the very rows the narration promises.
    await moveTo(page, frame.locator('[data-test="scp-capacity-section"] h2'));
    await cap.say('Its team’s capacity and plan, right where you were working.');
    await settle(page, 700);
    await frame
      .locator('table[aria-label="Sprint capacity by participant"] tbody tr')
      .last()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await settle(page, 600);
    await cap.say('');
    await settle(page, 1800);

    await moveTo(page, frame.getByRole('combobox', { name: 'Select a Sprint' }));
    await cap.say('Sprint Capacity Planner — always one click away, from anywhere in YouTrack.');
    await settle(page, 900);
    await cap.say('');
    await settle(page, 900);

    await info.attach('issue-launch.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('04-issue-launch');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
