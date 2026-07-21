/**
 * test:e2e — provision (when an instance is available) and run the Playwright suite.
 *
 * With YT_TEST_BASE_URL + an admin token present it makes the instance e2e-ready first:
 * build → pack → clean-install the app (UI automation) → seed the two e2e projects
 * (scripts/seed-e2e.mjs) → attach the app + add team members to both. Skip that with
 * E2E_SKIP_PROVISION=1 (fast re-runs against an already-provisioned instance) or
 * E2E_SKIP_BUILD=1 (reuse dist/). The Playwright specs self-skip when YT_TEST_BASE_URL
 * is unset, so this is safe to invoke without an instance (all-skipped, not failed).
 * Any extra CLI args are forwarded to Playwright.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, ARTIFACTS_DIR, fromRoot } from './lib/paths.mjs';

function sh(log, label, cmd, args, env = {}) {
  log.step(label);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

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

  const base = process.env.YT_TEST_BASE_URL;
  if (!base) {
    log.warn('YT_TEST_BASE_URL is unset — Playwright specs will skip themselves');
  }

  const token =
    process.env.YT_TEST_ADMIN_TOKEN ??
    (existsSync('/tmp/yt25-token.txt') ? readFileSync('/tmp/yt25-token.txt', 'utf8').trim() : '');
  const provision = base && token && process.env.E2E_SKIP_PROVISION !== '1';
  if (base && !token) {
    log.warn('no admin token (YT_TEST_ADMIN_TOKEN / /tmp/yt25-token.txt) — skipping provisioning');
  }

  if (provision) {
    const env = { YT_TEST_ADMIN_TOKEN: token };
    if (process.env.E2E_SKIP_BUILD !== '1') {
      sh(log, 'build', process.execPath, [fromRoot('scripts', 'build.mjs')]);
      sh(log, 'pack', process.execPath, [fromRoot('scripts', 'pack.mjs')]);
    }
    sh(log, 'install app (clean)', process.execPath, [fromRoot('scripts', 'install-app-youtrack.mjs')], env);
    // Seeds both projects incl. team membership (Hub REST) and the app configs.
    sh(log, 'seed e2e projects', process.execPath, [fromRoot('scripts', 'seed-e2e.mjs')], env);
    for (const key of ['SCPE1', 'SCPE2']) {
      sh(log, `attach app to ${key}`, process.execPath, [fromRoot('scripts', 'attach-app-to-project.mjs')], {
        ...env,
        PROJECT_KEY: key,
      });
    }
  }

  const extra = process.argv.slice(2);
  log.step('run playwright test');
  const res = spawnSync(
    process.execPath,
    [fromRoot('node_modules', '.bin', 'playwright'), 'test', ...extra],
    {
      stdio: 'inherit',
      cwd: REPO_ROOT,
      // Specs verify native YouTrack state over REST with the admin token.
      env: { ...process.env, ...(token ? { YT_TEST_ADMIN_TOKEN: token } : {}) },
    },
  );
  if (res.status !== 0) {
    process.exitCode = res.status ?? 1;
  }
});
