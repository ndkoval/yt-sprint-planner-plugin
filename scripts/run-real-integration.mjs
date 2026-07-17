/**
 * test:integration:real — orchestrate the real-YouTrack integration run.
 *
 * Order: require env -> provision (if needed) -> seed -> run integration tests under
 * tests/real-youtrack -> ALWAYS cleanup (finally).
 *
 * The vitest tests self-skip when YT_TEST_BASE_URL is unset, so this orchestrator is
 * the guarded entry point that actually stands up an instance. Exits non-zero if the
 * tests fail; cleanup still runs.
 */
import { spawnSync } from 'node:child_process';
import { runMain } from './lib/log.mjs';
import { REPO_ROOT, fromRoot } from './lib/paths.mjs';
import { readEnv } from './lib/yt-env.mjs';

function run(log, script) {
  log.step(`run ${script}`);
  const res = spawnSync(process.execPath, [fromRoot('scripts', script)], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
  });
  return res.status ?? 1;
}

function runVitest(log) {
  log.step('run vitest tests/real-youtrack');
  const res = spawnSync(
    process.execPath,
    [fromRoot('node_modules', '.bin', 'vitest'), 'run', 'tests/real-youtrack'],
    { stdio: 'inherit', cwd: REPO_ROOT },
  );
  return res.status ?? 1;
}

runMain('test:integration:real', async (log) => {
  const env = readEnv();
  if (!env.allowDestructive) {
    throw new Error('YT_TEST_ALLOW_DESTRUCTIVE=true is required for the real integration run');
  }

  // Provision only when there is no externally-supplied base URL/token already.
  const externallyProvided = Boolean(process.env.YT_TEST_BASE_URL && process.env.YT_TEST_ADMIN_TOKEN);
  let failed = false;

  try {
    if (!externallyProvided) {
      const code = run(log, 'provision-real-youtrack.mjs');
      if (code !== 0) throw new Error(`provision failed (exit ${code})`);
    } else {
      log.info('using externally-provided YT_TEST_BASE_URL/YT_TEST_ADMIN_TOKEN — skipping provision');
    }

    const seedCode = run(log, 'seed-real-youtrack.mjs');
    if (seedCode !== 0) throw new Error(`seed failed (exit ${seedCode})`);

    const testCode = runVitest(log);
    if (testCode !== 0) {
      failed = true;
      log.error(`integration tests failed (exit ${testCode})`);
    }
  } finally {
    log.step('cleanup (always runs)');
    const cleanupCode = run(log, 'cleanup-real-youtrack.mjs');
    if (cleanupCode !== 0) log.warn(`cleanup exited ${cleanupCode}`);
  }

  if (failed) {
    process.exitCode = 1;
  }
});
