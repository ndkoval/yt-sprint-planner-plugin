/**
 * provision-demo — make the running YouTrack fully demo-ready in one shot:
 * build+pack the app, (clean) install it, seed a project/team/managed-sprint/issues,
 * and attach the app to the project. Assumes a YouTrack is already running at
 * YT_TEST_BASE_URL with an admin token in /tmp/yt25-token.txt (Docker container
 * youtrack-scp on :8080 — see docs/memory). Idempotent; safe to re-run.
 */
import { spawnSync } from 'node:child_process';
import { runMain } from './lib/log.mjs';

function run(log, label, cmd, args, env) {
  log.step(label);
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(env ?? {}) },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (out) log.info(out.split('\n').slice(-4).join('\n'));
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

runMain('provision-demo', async (log) => {
  run(log, 'build', 'npm', ['run', 'build']);
  run(log, 'pack', 'npm', ['run', 'pack']);
  run(log, 'install app (clean)', 'node', ['scripts/install-app-youtrack.mjs']);
  // Seeds the users, BOTH projects (AppGlass + Orbit CRM), team membership (Hub REST),
  // boards, configs, Sprints and issues with their real assignees — one pass.
  run(log, 'seed projects + teams + sprints', 'node', ['scripts/setup-youtrack-demo.mjs']);
  run(log, 'attach app to AppGlass', 'node', ['scripts/attach-app-to-project.mjs'], {
    PROJECT_KEY: 'AGP',
  });
  run(log, 'attach app to Orbit CRM', 'node', ['scripts/attach-app-to-project.mjs'], {
    PROJECT_KEY: 'ORB',
  });
  log.info('YouTrack is demo-ready (AGP + ORB)');
});
