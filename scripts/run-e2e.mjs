/**
 * test:e2e — run the Playwright suite with the repo config.
 *
 * Ensures artifact output dirs exist first. The Playwright specs self-skip when
 * YT_TEST_BASE_URL is unset, so this is safe to invoke without an instance (it will
 * report all-skipped rather than fail). Any extra CLI args are forwarded to Playwright.
 */
import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, ARTIFACTS_DIR, fromRoot } from './lib/paths.mjs';

runMain('test:e2e', async (log) => {
  for (const dir of [
    ARTIFACTS_DIR,
    path.join(ARTIFACTS_DIR, 'test-results'),
    path.join(ARTIFACTS_DIR, 'playwright-report'),
    path.join(ARTIFACTS_DIR, 'videos'),
    path.join(ARTIFACTS_DIR, 'storage-state'),
  ]) {
    await mkdir(dir, { recursive: true });
  }

  if (!process.env.YT_TEST_BASE_URL) {
    log.warn('YT_TEST_BASE_URL is unset — Playwright specs will skip themselves');
  }

  const extra = process.argv.slice(2);
  log.step('run playwright test');
  const res = spawnSync(
    process.execPath,
    [fromRoot('node_modules', '.bin', 'playwright'), 'test', ...extra],
    { stdio: 'inherit', cwd: REPO_ROOT },
  );
  if (res.status !== 0) {
    process.exitCode = res.status ?? 1;
  }
});
