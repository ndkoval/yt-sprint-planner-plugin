import {
  test,
  expect,
  openProjectApp,
  appFrame,
  guardErrors,
  resetDemoState,
  Captioner,
  closeTitleCard,
  primeTitleCard,
  dragCard,
  moveTo,
  humanClick,
  settle,
} from './helpers.js';

/**
 * Reel #2 — the full app walkthrough, recorded 720p against the fixed prepared data set.
 * Every action is actually performed and visible: per-person capacity (incl. part-time), the
 * team switcher (Platform vs Mobile planning independently inside the same Sprint), the
 * drag-and-drop planning board with a card that visibly follows the cursor (pull from the
 * backlog, leave work unassigned, drag back to the backlog), over-capacity highlighting,
 * the in-page issue overlay with real edits, and the one-click next Sprint.
 */
test.describe('App walkthrough', () => {
  test.beforeAll(() => resetDemoState());

  test('plan a Sprint end to end', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // Paint the title card as the very first action so the reel's first frame is the branded card.
    await primeTitleCard(page, 'Sprint Capacity Planner', 'Plan two-week Sprints with confidence');
    const frame = await openProjectApp(page, 'Sprint Capacity', {
      reel: { title: 'Sprint Capacity Planner', subtitle: 'Plan two-week Sprints with confidence' },
      cap,
      intro: 'Sprint Capacity Planner — capacity planning right inside YouTrack.',
    });
    await closeTitleCard(page);

    // 1. Per-person capacity, including part-time members (Platform is the selected team).
    await expect(frame.getByText('Raw capacity')).toBeVisible();
    await cap.say('See each teammate’s capacity — full-time and part-time — with their load and what’s left.');
    await moveTo(page, frame.getByText('Bob Jones').first());
    await settle(page, 900);

    // 2. Teams: a big project plans as small teams inside the same Sprint.
    const board = await appFrame(page);
    await cap.say('Big projects plan as small teams — Platform is selected; Mobile plans on its own.');
    await moveTo(page, board.locator('[data-test="scp-team-select"]'));
    await settle(page, 900);

    // 3. The planning board + over-capacity highlight.
    await cap.say('Plan the work on a drag-and-drop board — one timeline lane per teammate.');
    await moveTo(page, board.getByRole('heading', { name: /Plan work — drag issues/i }));
    await settle(page, 700);
    await cap.say('Too much unassigned work flags the team over capacity — even when each person fits.');
    await moveTo(page, board.locator('[data-test="scp-fit-banner"]'));
    await settle(page, 900);

    // 4. Pull an issue from the backlog onto a teammate — the card visibly follows the cursor.
    await cap.say('Drag an issue from the backlog onto a teammate — it joins the Sprint and is assigned in one move.');
    await dragCard(
      page,
      board,
      board.locator('[title*="Search indexing"]').first(),
      board.getByLabel(/^Lane Alice/).first(),
    );
    await expect(board.getByLabel(/^Lane Alice/).locator('[title*="Search indexing"]')).toBeVisible();
    await settle(page, 900);

    // 5. Leaving work unassigned is fine — drop one onto the Unassigned lane.
    await cap.say('Not ready to assign it? Drop it on Unassigned — it still counts toward the Sprint.');
    await dragCard(
      page,
      board,
      board.locator('[title*="CSV export"]').first(),
      board.getByLabel(/^Lane Unassigned/).first(),
    );
    await expect(board.getByLabel(/^Lane Unassigned/).locator('[title*="CSV export"]')).toBeVisible();
    await settle(page, 900);

    // 6. Changed your mind? Drag an issue back to the backlog to drop it from the Sprint.
    await cap.say('Changed your mind? Drag it back to the backlog to drop it from the Sprint.');
    await dragCard(
      page,
      board,
      board.getByLabel(/^Lane Unassigned/).locator('[title*="Localization polish"]').first(),
      board.getByLabel('Lane Backlog').first(),
    );
    await expect(board.getByLabel('Lane Backlog').locator('[title*="Localization polish"]')).toBeVisible();
    await settle(page, 900);

    // 7. Switch to the Mobile team — its own lanes, capacity and focus factor.
    await cap.say('Switch teams anytime — Mobile has its own lanes, capacity and focus factor.');
    await humanClick(page, board.getByRole('combobox', { name: 'Select a team' }));
    await humanClick(page, board.locator('[data-test="ring-popup"]').getByText('Mobile', { exact: true }));
    await expect(board.getByLabel(/^Lane Charlie/)).toBeVisible();
    await moveTo(page, board.getByLabel(/^Lane Charlie/).first());
    await settle(page, 1200);

    // Back to Platform for the issue-editing scene.
    await humanClick(page, board.getByRole('combobox', { name: 'Select a team' }));
    await humanClick(page, board.locator('[data-test="ring-popup"]').getByText('Platform', { exact: true }));
    await expect(board.getByLabel(/^Lane Alice/)).toBeVisible();
    await settle(page, 700);

    // 8. Double-click a card → the issue opens in an in-page overlay over the dimmed plan (never
    // a new tab). Edit a field right there, then close to return to the plan.
    await cap.say('Double-click any issue to open it right here — over your plan, never a new tab.');
    const checkoutCard = board.locator('[title*="Checkout API"]').first();
    await moveTo(page, checkoutCard);
    await checkoutCard.dblclick();
    const overlay = board.locator('[data-test="scp-issue-overlay"]');
    await expect(overlay).toBeVisible();
    await settle(page, 900);

    // Add details: type a description right in the overlay (saves on blur).
    await cap.say('Add details — type a description right here.');
    const descBox = overlay.getByLabel('Issue description');
    await descBox.click();
    await descBox.pressSequentially('Harden checkout: retries, idempotency keys, and clearer error states.', { delay: 18 });
    await descBox.blur();
    await settle(page, 1400);

    // Change a field: set the priority with the native-style inline select.
    await cap.say('Change any field — here, bump the priority.');
    const prioField = overlay.locator('[data-field="Priority"]');
    if (await prioField.count()) {
      await humanClick(page, prioField.getByRole('combobox'));
      const prioPopup = board.locator('[data-test="ring-popup"]');
      const target = prioPopup.getByText(/Critical|Major|Show-stopper/).first();
      if (await target.count()) await humanClick(page, target);
      await settle(page, 1500);
    }
    // The issue key links straight to the full native issue view.
    await cap.say('And the issue key opens the full page in a new tab whenever you need it.');
    await moveTo(page, overlay.locator('[data-test="scp-issue-overlay-open-native"]'));
    await settle(page, 900);
    await info.attach('issue-overlay.png', { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {});
    await cap.say('Every change saves instantly — then close and you’re back on your plan.');
    await overlay.locator('[data-test="scp-issue-overlay-close"]').click().catch(() => {});
    await expect(overlay).toBeHidden();
    await settle(page, 800);

    // 9. One-click next Sprint (planner) — show the computed preview, then close.
    await cap.say('Create the next Sprint in one click — dates and every team’s focus factor are computed for you.');
    await humanClick(page, board.getByRole('button', { name: 'Create next Sprint' }));
    await expect(board.getByText(/AppGlass \d{4}-S\d+/).first()).toBeVisible();
    await settle(page, 1300);
    const cancel = board.getByRole('button', { name: /^Cancel$/ });
    if (await cancel.count()) await cancel.first().click({ force: true }).catch(() => {});
    await settle(page, 900);

    await cap.say('Sprint Capacity Planner — plan with confidence, right inside YouTrack.');
    await settle(page, 1400);
    await info.attach('walkthrough.png', { body: await page.screenshot(), contentType: 'image/png' });

    const vtt = await cap.writeVtt('02-walkthrough');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
