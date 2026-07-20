/**
 * provision-demo — make the running YouTrack fully demo-ready in one shot:
 * build+pack the app, (clean) install it, seed a project/team/managed-sprint/issues,
 * and attach the app to the project. Assumes a YouTrack is already running at
 * YT_TEST_BASE_URL with an admin token in /tmp/yt25-token.txt (Docker container
 * youtrack-scp on :8080 — see docs/memory). Idempotent; safe to re-run.
 */
import { spawnSync } from 'node:child_process';
import { runMain } from './lib/log.mjs';

// Demo team display names — kept in sync with setup-youtrack-demo.mjs so add-team-members
// makes every planned teammate assignable in the project.
const MEMBER_NAMES = 'Alice Smith,Bob Jones,Charlie Diaz,Dana Lee,Erin Park';

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
  // First seed pass: creates the users, project, board, config and Sprint. Assignments to
  // users not yet on the project team fall back to admin.
  run(log, 'seed project + team + sprint', 'node', ['scripts/setup-youtrack-demo.mjs']);
  // Add the whole team to the project so everyone is assignable (UI-only in YouTrack).
  run(log, 'add team members to project', 'node', ['scripts/add-team-members.mjs'], {
    MEMBER_NAMES,
  });
  // Second seed pass: re-seeds the issues, now assigning them to the real teammates.
  run(log, 'reseed issues with assignees', 'node', ['scripts/setup-youtrack-demo.mjs']);
  run(log, 'attach app to project', 'node', ['scripts/attach-app-to-project.mjs']);
  log.info('YouTrack is demo-ready');
});
