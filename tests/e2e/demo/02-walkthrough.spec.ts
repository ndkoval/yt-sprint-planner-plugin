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
 * drag-and-drop planning board with a card that visibly follows the cursor (pull from the
 * backlog, leave work unassigned, drag back to the backlog), over-capacity highlighting,
 * one-click next Sprint, and double-clicking a card to open YouTrack's OWN native issue view
 * on the Kanban board (full details + editable estimate).
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

    // 1. Per-person capacity, including part-time members.
    await expect(frame.getByText('Raw capacity')).toBeVisible();
    await cap.say('See each teammate’s capacity — full-time and part-time — with their load and what’s left.');
    await moveTo(page, frame.getByText('Bob Jones').first());
    await settle(page, 900);

    // 2. The planning board + over-capacity highlight.
    const board = await appFrame(page);
    await cap.say('Plan the work on a drag-and-drop board — one timeline lane per teammate.');
    await moveTo(page, board.getByRole('heading', { name: /Plan work — drag issues/i }));
    await settle(page, 700);
    await cap.say('Even when everyone individually fits, too much unassigned work flags the Sprint over capacity.');
    await moveTo(page, board.getByText(/Over planned capacity|Fits —/).first());
    await settle(page, 900);

    // 3. Pull an issue from the backlog onto a teammate — the card visibly follows the cursor.
    // Drop onto a card already in the destination lane (a small, unambiguous, on-screen target).
    await cap.say('Drag an issue from the backlog onto a teammate — it joins the Sprint and is assigned in one move.');
    await dragCard(
      page,
      board,
      board.locator('[title*="Search indexing"]').first(),
      board.getByLabel(/^Lane Alice/).first(),
    );
    await expect(board.getByLabel(/^Lane Alice/).locator('[title*="Search indexing"]')).toBeVisible();
    await settle(page, 900);

    // 4. Leaving work unassigned is fine — drop one onto the Unassigned lane.
    await cap.say('Not ready to assign it? Drop it on Unassigned — it still counts toward the Sprint.');
    await dragCard(
      page,
      board,
      board.locator('[title*="CSV export"]').first(),
      board.getByLabel(/^Lane Unassigned/).first(),
    );
    await expect(board.getByLabel(/^Lane Unassigned/).locator('[title*="CSV export"]')).toBeVisible();
    await settle(page, 900);

    // 5. Changed your mind? Drag an issue back to the backlog to drop it from the Sprint.
    await cap.say('Changed your mind? Drag it back to the backlog to drop it from the Sprint.');
    await dragCard(
      page,
      board,
      board.getByLabel(/^Lane Unassigned/).locator('[title*="Mobile responsive"]').first(),
      board.getByLabel('Lane Backlog').first(),
    );
    await expect(board.getByLabel('Lane Backlog').locator('[title*="Mobile responsive"]')).toBeVisible();
    await settle(page, 900);

    // 6. Double-click a card → the issue opens in an in-page overlay over the dimmed plan (never
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

    // Change a field: set the priority.
    await cap.say('Change any field — here, bump the priority.');
    const prioSelect = overlay.getByLabel('Priority');
    if (await prioSelect.count()) {
      const opts = await prioSelect.locator('option').allTextContents();
      const target = opts.find((o) => /critical|major|high/i.test(o)) ?? opts[opts.length - 1];
      if (target) await prioSelect.selectOption({ label: target }).catch(() => {});
      await settle(page, 1500);
    }
    await info.attach('issue-overlay.png', { body: await page.screenshot(), contentType: 'image/png' }).catch(() => {});
    await cap.say('Every change saves instantly — then close and you’re back on your plan.');
    await overlay.getByRole('button', { name: /Close/ }).first().click().catch(() => {});
    await expect(overlay).toBeHidden();
    await settle(page, 800);

    // 7. One-click next Sprint (planner) — show the computed preview, then close.
    await cap.say('Create the next Sprint in one click — name, dates and focus factor are computed for you.');
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
