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
import { chromium, type FullConfig } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
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

  // Save an authenticated admin session for the journeys.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const user = (await page.$('input#username')) ?? (await page.$('input[type=text]'));
  if (user) {
    await user.fill(USER);
    await (await page.$('input[type=password]'))!.fill(PASS);
    await (await page.$('button[type=submit]'))!.click();
    await page.waitForTimeout(4500);
  }
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
