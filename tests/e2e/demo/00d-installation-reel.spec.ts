import { test, expect, guardErrors, humanClick, moveTo, settle, Captioner } from './helpers.js';

/**
 * Marketing reel #4 — installation. A subtitled, cursored walk through installing the
 * app from its single ZIP and attaching it to a project, ending in the settings screen.
 * The install screen is a faithful simulation of YouTrack's "Install app" admin flow
 * (a live instance can't run its scripting engine on this platform — see CHANGELOG).
 */
test.describe('Marketing reel — installation', () => {
  test('install the app from one ZIP and open its settings', async ({ page }, info) => {
    const assertClean = guardErrors(page);
    const cap = new Captioner(page);

    await page.goto('/install', { waitUntil: 'networkidle' });
    await cap.say('Install Sprint Capacity Planner from a single ZIP');
    await expect(page.getByRole('heading', { name: 'Install app' })).toBeVisible();
    await moveTo(page, page.getByText('sprint-capacity-planner.zip').first());
    await cap.say('One package — no external services, no database');
    await settle(page, 800);

    await humanClick(page, page.getByRole('button', { name: 'Install' }));
    await expect(page.getByText(/Installed — Sprint Capacity Planner/)).toBeVisible({
      timeout: 15_000,
    });
    await cap.say('Attach it to your project');
    await humanClick(page, page.getByRole('button', { name: /Attach to project/ }));
    await expect(page.getByText(/installed and attached/i)).toBeVisible();
    await settle(page, 600);

    await cap.say('Open Sprint Capacity Settings to finish setup');
    await humanClick(page, page.getByRole('link', { name: /Open Sprint Capacity Settings/ }));
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Agile board' })).toBeVisible();
    await cap.say('Pick your board and effort fields — you’re ready to plan');
    await settle(page, 1500);
    await info.attach('installation.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });

    const vtt = await cap.writeVtt('04-installation');
    await info.attach('subtitles.vtt', { path: vtt, contentType: 'text/vtt' });
    assertClean();
  });
});
