/**
 * capture-screenshots — refresh the README gallery (docs/media/screenshots/*.png)
 * against a REAL YouTrack prepared with the fixed demo data (run `npm run demo:reset`
 * first). Captures 1920px-wide @2x viewport shots of the five representative pages:
 * capacity table, planning board (over-capacity banner in view), issue overlay,
 * create-next-Sprint dialog, and the per-team settings card.
 *
 * Env: YT_TEST_BASE_URL (default http://localhost:8080), YT_TEST_MANAGER_LOGIN/PASSWORD.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const OUT = 'docs/media/screenshots';

const log = (...a) => console.log('[screenshots]', ...a);

/** The app widget's srcdoc frame, identified by content. */
async function appFrame(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const marker = '[data-test="scp-ready"], [data-test="scp-settings"]';
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      if ((await f.locator(marker).count().catch(() => 0)) > 0) return f;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('app widget frame not found');
}

async function shoot(page, locator, file) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${file}` });
  log(file);
}

runMain().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });

async function runMain() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 960, height: 800 },
    deviceScaleFactor: 2,
  });

  // Login.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const user = (await page.$('input#username')) ?? (await page.$('input[type=text]'));
  if (user) {
    await user.fill(USER);
    await (await page.$('input[type=password]')).fill(PASS);
    await (await page.$('button[type=submit]')).click();
    await page.waitForTimeout(4000);
  }

  // The AGP planner (Platform team selected by default).
  await page.goto(`${BASE}/projects/AGP?tab=sprint-capacity-planner%3ASprint+Capacity`, {
    waitUntil: 'domcontentloaded',
  });
  let frame = await appFrame(page);
  await frame.locator('[data-test="scp-ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // 01 — capacity table (scoped "Capacity — Platform" header in view).
  await shoot(page, frame.locator('[data-test="scp-capacity-section"]'), '01-capacity.png');

  // 02 — planning board with the fit banner.
  await shoot(page, frame.locator('[data-test="scp-fit-banner"]'), '02-planning-board.png');

  // 03 — the in-page issue overlay (double-click a card).
  const card = frame.locator('[data-test="scp-card"]', { hasText: 'Checkout API' }).first();
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  const overlay = frame.locator('[data-test="scp-issue-overlay"]');
  await overlay.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shoot(page, overlay, '03-issue-overlay.png');
  await frame.locator('[data-test="scp-issue-overlay-close"]').click();

  // 04 — create-next-Sprint dialog (named for the team).
  await frame.getByRole('button', { name: 'Create next Sprint' }).click();
  const dialog = frame.getByRole('dialog');
  await dialog.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await shoot(page, dialog, '04-create-next-sprint.png');
  await dialog.getByRole('button', { name: /^Cancel$/ }).evaluate((el) => el.click());

  // 05 — settings: the per-team card with scoped headers ("Agile board — Platform").
  await frame.getByRole('button', { name: 'Settings', exact: true }).click();
  frame = await appFrame(page);
  await frame.locator('[data-test="scp-settings"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1000);
  await shoot(
    page,
    frame.locator('[data-test="scp-team-card"]').first().getByText('Agile board — Platform'),
    '05-settings.png',
  );

  await browser.close();
  log('done ->', OUT);
}
