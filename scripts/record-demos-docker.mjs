/**
 * record-demos-docker — record the two demo reels headed under a virtual display (Xvfb)
 * inside a Docker container, then add the voiceover on the host.
 *
 * The reels MUST be recorded in Docker with a virtual display (project rule). This script:
 *   1. builds a tiny recorder image (Playwright 1.49.1 + ffmpeg),
 *   2. runs the Playwright demo suite headed under `xvfb-run` in that container, reaching the
 *      HOST YouTrack at host.docker.internal:8080 (Linux node_modules live in a named volume
 *      so the host's macOS node_modules never leak in), then
 *   3. renders the voiceover + a video-review report on the host (macOS `say` + ffmpeg).
 *
 * The container reseeds the fixed prepared demo state before each reel (deterministic data).
 * Requires: Docker running; a host YouTrack on :8080 with the app installed; admin/hub tokens
 * in /tmp/yt25-token.txt & /tmp/yt25-hubtoken.txt (or YT_TEST_ADMIN_TOKEN / YT_TEST_HUB_TOKEN).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'scp-demo-recorder';
const NODE_MODULES_VOLUME = 'scp_demo_node_modules';

function readTok(file, env) {
  if (process.env[env]) return process.env[env];
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO, ...opts });
  if (r.status !== 0) {
    console.error(`✗ FAILED (exit ${r.status ?? 'signal'}): ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

const TOKEN = readTok('/tmp/yt25-token.txt', 'YT_TEST_ADMIN_TOKEN');
const HUB_TOKEN = readTok('/tmp/yt25-hubtoken.txt', 'YT_TEST_HUB_TOKEN') || TOKEN;
if (!TOKEN) {
  console.error('No admin token (set YT_TEST_ADMIN_TOKEN or create /tmp/yt25-token.txt).');
  process.exit(1);
}

// 1) Build the recorder image (context is docker/, so it stays tiny).
run('docker', ['build', '-t', IMAGE, '-f', 'docker/demo-recorder.Dockerfile', 'docker']);

// 1b) Trust the container's origin (host.docker.internal:8080) as an OAuth redirect address,
// else the in-container browser hits YouTrack's "resource address not registered as a trusted
// access address" error. Idempotent.
run('node', ['scripts/trust-redirect-host.mjs']);

// 2) Record headed under a virtual display, driving the host YouTrack.
//
// We start Xvfb explicitly (rather than `xvfb-run`, which hangs if the test process crashes
// instead of propagating the exit code) and make the Playwright run the container's final
// command so its exit status becomes the container's — a failure exits cleanly, never hangs.
// `playwright install chromium` is a fast no-op when the image already has the matching
// browser, and self-heals a version drift between the image and the installed Playwright.
const inner = [
  '[ -x node_modules/.bin/playwright ] || npm ci --no-audit --no-fund || exit 1',
  'npx playwright install chromium >/dev/null 2>&1 || true',
  'Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &',
  'export DISPLAY=:99',
  'for i in $(seq 1 40); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.25; done',
  'npx playwright test --config playwright.demo.config.ts; rc=$?',
  // The container runs as root, so whatever it wrote under artifacts/ is root-owned on the host
  // bind mount — the host-side render-reels (a non-root user on Linux/CI) then can't create
  // artifacts/demo/reels. Hand artifacts/ back to the repo's owner before exiting (a no-op on
  // Docker Desktop, which already maps to the host user). Preserve Playwright's exit code.
  'chown -R "$(stat -c %u:%g /work)" /work/artifacts 2>/dev/null || true',
  'exit $rc',
].join('\n');

run('docker', [
  'run',
  '--rm',
  '--add-host=host.docker.internal:host-gateway',
  '-v',
  `${REPO}:/work`,
  '-v',
  `${NODE_MODULES_VOLUME}:/work/node_modules`,
  '-e',
  'CI=1',
  '-e',
  'DEMO_HEADED=1',
  // Global setup only logs in + saves storageState; each reel reseeds the prepared state.
  '-e',
  'DEMO_SKIP_PROVISION=1',
  '-e',
  'YT_TEST_BASE_URL=http://host.docker.internal:8080',
  '-e',
  `YT_TEST_ADMIN_TOKEN=${TOKEN}`,
  '-e',
  `YT_TEST_HUB_TOKEN=${HUB_TOKEN}`,
  // Record logged in as the admin account, whose display name the seed sets to "Nikita Koval"
  // (the demo's main user). Reseeding uses the admin token above; this is just the browser login.
  '-e',
  `YT_TEST_MANAGER_LOGIN=${process.env.YT_TEST_MANAGER_LOGIN ?? 'admin'}`,
  '-e',
  `YT_TEST_MANAGER_PASSWORD=${process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!'}`,
  IMAGE,
  'bash',
  '-lc',
  inner,
]);

// 3) Voiceover + review on the host (Piper/`say` + ffmpeg) over the recorded webm + WebVTT.
run('node', ['scripts/render-reels.mjs'], { env: { ...process.env, REELS_BASE: 'demo' } });

// QA review. Locally this GATES the shipping reels (any FAIL aborts). In CI the meaningful gate
// is that the reels RECORDED end-to-end against a real YouTrack (steps above); the auto-recorded
// reels' QA is advisory — the raw reels keep a brief pre-trim intro frame (publish-demo-assets
// trims it for the docs/media reels) that would otherwise fail the intro check. We still produce
// and upload the report either way.
const analyzeArgs = [
  '.claude/skills/demo-video-review/scripts/analyze-video.mjs',
  'artifacts/demo/reels',
  'artifacts/demo/subtitles',
  '--out',
  'artifacts/demo/reels/video-review.md',
];
if (process.env.CI) {
  console.log(`\n▶ node ${analyzeArgs.join(' ')} (advisory in CI)`);
  const r = spawnSync('node', analyzeArgs, { stdio: 'inherit', cwd: REPO });
  if (r.status !== 0) {
    console.warn(`⚠ video-review reported issues (exit ${r.status}) — see artifacts/demo/reels/video-review.md`);
  }
} else {
  run('node', analyzeArgs);
}

console.log('\n✓ Reels recorded in Docker (Xvfb) and voiced on host → artifacts/demo/reels/');
