/**
 * Global setup for the REAL-YouTrack demo suite. Ensures the instance is reachable,
 * provisions it demo-ready (app installed + project/team/sprint/issues seeded + attached),
 * and saves an authenticated admin storageState so each journey starts logged in.
 *
 * A YouTrack must already be running at YT_TEST_BASE_URL (the Dockerized 2025.3
 * instance — see docs/memory).
 *
 * Data determinism: before recording, the instance is reset to a fixed, prepared demo state
 * (`scripts/setup-youtrack-demo.mjs` — wipe + seed the same team/issues/backlog every time)
 * so the reels always show identical data. Env:
 *   - DEMO_SKIP_PROVISION=1  reuse whatever state is already there (no reset)
 *   - DEMO_FULL_PROVISION=1  force a full provision (rebuild + clean reinstall + seed)
 */
import { chromium, type Frame, type FullConfig } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
// The reels log in as the admin account, whose display name the seed sets to "Nikita Koval"
// (the demo's main user). Provisioning itself uses the admin token, not this browser login.
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
export const STORAGE_STATE = path.resolve('artifacts/demo/storageState.json');

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/config?fields=version`);
    return r.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });

  if (!(await reachable())) {
    throw new Error(
      `YouTrack not reachable at ${BASE}. Start the Docker instance first ` +
        `(jetbrains/youtrack:2025.3 — see docs). This suite requires a YouTrack instance.`,
    );
  }

  if (process.env.DEMO_SKIP_PROVISION !== '1') {
    // Fast, deterministic reset to the prepared state (no reinstall). Fall back to a full
    // provision (rebuild + clean install + seed) if the app isn't installed/configured yet
    // or when explicitly requested.
    const full = process.env.DEMO_FULL_PROVISION === '1';
    const reset = full
      ? null
      : spawnSync('node', ['scripts/setup-youtrack-demo.mjs'], { encoding: 'utf8', stdio: 'inherit' });
    if (full || reset === null || reset.status !== 0) {
      const r = spawnSync('node', ['scripts/provision-demo.mjs'], { encoding: 'utf8', stdio: 'inherit' });
      if (r.status !== 0) throw new Error('provision-demo failed');
    }
  }

  // Save an authenticated admin session for the journeys. Same robust flow as
  // tests/e2e/auth.setup.ts: locator-based (no stale page.$ handles), let the
  // 2026.x silent-SSO redirect (…?request_credentials=skip) settle, submit, wait a
  // flat beat for the OAuth-callback chain, and retry — a URL-predicate/detached
  // wait raced the bounce and once saved an UNAUTHENTICATED storageState (every
  // reel then failed). Confirm authenticated before saving.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const onLogin = (u: string): boolean => /\/hub\/auth\/login|[?&]login|\/login\b/i.test(u);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if (!onLogin(page.url())) break;
    const user = page.locator('input#username, input[type=text]').first();
    if (!(await user.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) continue;
    await user.fill(USER);
    await page.locator('input[type=password]').first().fill(PASS);
    await page.locator('button[type=submit]').first().click();
    await page.waitForTimeout(7000);
    if (!onLogin(page.url())) break;
  }
  if (onLogin(page.url())) throw new Error('demo global-setup could not authenticate the admin session');
  // Dismiss the platform's first-run onboarding OFF-CAMERA (2026.x shows a
  // "Welcome! Let's get started" tour panel with a JetBrains AI promo on project
  // pages) so it never appears in a reel. Both dismissals persist in the profile.
  try {
    await page.goto(`${BASE}/projects/AGP`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const skip = page.getByRole('button', { name: /Skip the tour/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await page.waitForTimeout(800);
    }
    const aiClose = page
      .locator('div', { hasText: 'JetBrains AI' })
      .getByRole('button', { name: /close|dismiss/i })
      .first();
    if (await aiClose.isVisible().catch(() => false)) await aiClose.click().catch(() => {});
    await page.waitForTimeout(500);
    console.warn('[demo-setup] onboarding tour dismissed');
  } catch (e) {
    console.warn('[demo-setup] tour dismissal skipped:', e instanceof Error ? e.message.slice(0, 100) : String(e));
  }

  await page.context().storageState({ path: STORAGE_STATE });

  // Pre-authorize the app's DELETE requests so the consent prompt YouTrack shows the
  // first time an app DELETEs (removing an issue from a sprint) never appears ON
  // CAMERA. We trigger a real drag-to-backlog off-camera and click "Allow and don't
  // ask again"; each reel reseeds the data afterwards, so the mutation is harmless.
  try {
    await page.goto(
      `${BASE}/projects/AGP?tab=sprint-capacity-planner%3ASprint+Capacity`,
      { waitUntil: 'domcontentloaded' },
    );
    let widget: Frame | null = null;
    for (let i = 0; i < 60 && !widget; i += 1) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        if ((await f.locator('[data-test="scp-card"]').count().catch(() => 0)) > 0) widget = f;
      }
      if (!widget) await page.waitForTimeout(500);
    }
    if (widget) {
      await widget.evaluate(() => {
        const card = document.querySelector('[data-test="scp-lane"] [data-test="scp-card"]');
        const backlog = document.querySelector('[data-test="scp-lane-backlog"]');
        if (!card || !backlog) throw new Error('no card/backlog to pre-authorize with');
        const dt = new DataTransfer();
        const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        card.dispatchEvent(new DragEvent('dragstart', opts));
        backlog.dispatchEvent(new DragEvent('dragover', opts));
        backlog.dispatchEvent(new DragEvent('drop', opts));
        card.dispatchEvent(new DragEvent('dragend', opts));
      });
      const allow = page.getByRole('button', { name: /Allow and don't ask again/i });
      await allow.waitFor({ state: 'visible', timeout: 8000 });
      await allow.click();
      await page.waitForTimeout(1500);
      console.warn('[demo-setup] app DELETE requests pre-authorized');
    }
  } catch (e) {
    console.warn(
      '[demo-setup] DELETE pre-authorization skipped:',
      e instanceof Error ? e.message.slice(0, 120) : String(e),
    );
  }
  await browser.close();
}
