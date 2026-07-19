/**
 * Global setup for the REAL-YouTrack demo suite. Ensures the instance is reachable,
 * provisions it demo-ready (app installed + project/team/sprint/issues seeded + attached),
 * and saves an authenticated admin storageState so each journey starts logged in.
 *
 * A real YouTrack must already be running at YT_TEST_BASE_URL (the Dockerized 2025.3
 * instance — see docs/memory). Set REAL_DEMO_SKIP_PROVISION=1 to reuse existing seed data.
 */
import { chromium, type FullConfig } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const USER = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASS = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
export const STORAGE_STATE = path.resolve('artifacts/real-demo/storageState.json');

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
      `Real YouTrack not reachable at ${BASE}. Start the Docker instance first ` +
        `(jetbrains/youtrack:2025.3 — see docs). This suite requires a real instance.`,
    );
  }

  if (process.env.REAL_DEMO_SKIP_PROVISION !== '1') {
    const r = spawnSync('node', ['scripts/provision-real-demo.mjs'], { encoding: 'utf8', stdio: 'inherit' });
    if (r.status !== 0) throw new Error('provision-real-demo failed');
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
