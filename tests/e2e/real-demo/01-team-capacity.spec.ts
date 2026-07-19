import {
  test,
  expect,
  openProjectApp,
  appFrame,
  guardErrors,
  Captioner,
  closeTitleCard,
  moveTo,
  settle,
} from './helpers.js';

/**
 * Marketing reel #2 (REAL YouTrack): team capacity + per-person load. Shows the real
 * capacity table (whole team), the per-person Load bar (committed vs capacity, red when
 * over), the Sprint-level "what fits" banner, and the effort roll-up with the Unassigned
 * bucket — all inside a real YouTrack project.
 */
test.describe('Real YouTrack — team capacity', () => {
  test('capacity, per-person load and what-fits on a real instance', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    const frame = await openProjectApp(page, 'Sprint Capacity', {
      reel: { title: 'Plan capacity with your team', subtitle: 'Per-person load, on real YouTrack' },
      cap,
      intro: 'Plan capacity for the whole team, inside YouTrack.',
    });
    await closeTitleCard(page);

    await expect(frame.getByText('Alice Smith')).toBeVisible();
    await cap.say('Every teammate has a capacity row with their available days.');
    await moveTo(page, frame.getByRole('columnheader', { name: /Load/ }));
    await settle(page, 700);

    await cap.say('The Load bar compares committed work to each person’s capacity.');
    await cap.say('Over-commitment turns red.');
    await expect(frame.getByText(/⚠ over/).first()).toBeVisible();
    await settle(page, 800);

    const f = await appFrame(page);
    await cap.say('The what-fits banner shows if the Sprint plan fits.');
    await moveTo(page, f.getByText(/headroom|over by/i).first());
    await settle(page, 800);

    await cap.say('Effort rolls up, with a bucket for unassigned work.');
    await moveTo(page, f.getByText('Unassigned'));
    await settle(page, 1000);

    await cap.say('Sprint Capacity Planner — real capacity planning in YouTrack.');
    await settle(page, 1400);

    await info.attach('team-capacity.png', { body: await page.screenshot(), contentType: 'image/png' });
    const vtt = await cap.writeVtt('02-real-team-capacity');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
