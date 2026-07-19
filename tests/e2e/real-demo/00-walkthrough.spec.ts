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
 * Marketing reel #1 (REAL YouTrack): a continuous, subtitled walkthrough of the app
 * running inside a real YouTrack project — capacity + effort + the "what fits" check,
 * one-click next Sprint with carry-over, and the native Kanban board. Recorded 720p.
 */
test.describe('Real YouTrack — product walkthrough', () => {
  test('plan a Sprint end to end on a real instance', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    // ── 1. Open the app inside a real YouTrack project (title card up during load).
    const frame = await openProjectApp(page, 'Sprint Capacity', {
      reel: { title: 'Sprint Capacity Planner', subtitle: 'Running inside real YouTrack' },
      cap,
      intro: 'Sprint Capacity Planner — inside a real YouTrack project.',
    });
    await closeTitleCard(page);

    await expect(frame.getByText('Raw capacity')).toBeVisible();
    await cap.say('See raw, planned and remaining capacity for the whole team.');
    await moveTo(page, frame.getByText('Raw capacity'));
    await expect(frame.getByText('Alice Smith')).toBeVisible();
    await settle(page, 800);

    // "What fits" banner.
    await cap.say('The what-fits banner shows whether the plan fits the Sprint.');
    await moveTo(page, frame.getByText(/headroom|over by/i).first());
    await expect(frame.getByText(/headroom|over by/i).first()).toBeVisible();
    await settle(page, 800);

    // Effort.
    await cap.say('Effort and remaining capacity recompute from the live issues.');
    await moveTo(page, frame.getByText('Original effort'));
    await settle(page, 1000);

    // ── 2. Create the next Sprint in one click.
    const f2 = await appFrame(page); // re-acquire (the widget iframe re-renders on auto-refresh)
    await cap.say('Create the next Sprint in one click.');
    await humanClick(page, f2.getByRole('button', { name: 'Create next Sprint' }));
    // Preview name is the next in sequence (state-agnostic across runs).
    await expect(f2.getByText(/AppGlass \d{4}-S\d+/).first()).toBeVisible();
    await cap.say('Name, dates and focus factor are computed for you.');
    await settle(page, 800);
    // Carry over unfinished work if offered.
    const carry = f2.getByText(/Carry over/i).first();
    if (await carry.count()) {
      await cap.say('Carry over the unfinished work, like Jira’s complete-sprint step.');
      await moveTo(page, carry);
      await settle(page, 600);
    }
    await humanClick(page, f2.getByRole('button', { name: 'Create Sprint' }));
    await settle(page, 1800);
    // The new Sprint is created on the native YouTrack board; the board itself is shown in
    // the dedicated native-board reel (03-board), so we don't open the popup here (a
    // popup-wait can hang). End on the planner, which now reflects the new Sprint.
    await cap.say('The Sprint is created on YouTrack’s native board.');
    await settle(page, 900);
    await cap.say('Sprint Capacity Planner — plan with confidence, on real YouTrack.');
    await settle(page, 1500);
    await info.attach('walkthrough.png', { body: await page.screenshot(), contentType: 'image/png' });

    const vtt = await cap.writeVtt('01-real-walkthrough');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
