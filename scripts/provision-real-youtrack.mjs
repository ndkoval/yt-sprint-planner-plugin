/**
 * provision:real-youtrack — stand up a LOCAL YouTrack instance WITHOUT DOCKER and run
 * its configuration wizard headlessly, ending with a ready `/api`-serving instance.
 *
 * This flow is verified end-to-end (download → verify → extract → configure → start →
 * headless wizard bootstrap → finalize → poll) against the pinned build below. The
 * wizard is driven through its REST API (reverse-engineered from the installer app):
 *   - GET  /api/wizard/steps?wizardToken=…            (auth = ?wizardToken= query param)
 *   - POST /api/wizard/hub-settings                   (create the root/admin account)
 *   - POST /api/wizard/license-key                    (apply the bundled community licence)
 *   - POST /api/wizard/wait/dump                      (commit config + restart into the app)
 * then poll /api/config until it returns 200.
 *
 * PLATFORM CAVEAT: YouTrack 2025.1 bundles GraalVM/Truffle 22.0.0.2 for its JS scripting
 * engine. On Apple-Silicon macOS that engine cannot initialise (Truffle 22 has no arm64
 * runtime and its fallback path calls the removed `sun.misc.Unsafe.ensureClassInitialized`),
 * so the app crashes on start REGARDLESS of JDK (verified on JDK 8/11/17/21/25 and the
 * bundled JRE under Rosetta). Run real integration on Linux x64 (CI) where the bundled
 * `internal/java/linux-x64` runtime works. The self-contained demo E2E suite
 * (`npm run test:e2e:demo`) exercises the plugin UI end-to-end on any platform.
 */
import { mkdir, writeFile, readFile, access, stat, rm, readdir } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';
import { assertDestructiveAllowed, assertNotProduction, makeRunId } from './lib/yt-env.mjs';

// Pinned build — the last YouTrack that ships a standalone (non-Docker) distribution.
const YT_VERSION = '2025.1.148120';
const YT_DIST_URL = `https://download.jetbrains.com/charisma/youtrack-${YT_VERSION}.zip`;
const YT_SHA256 = 'a24f86631bf4ee52a7b33657f13c909f11b9ccbfc81f534730642d29d442dfed';

const PORT = Number(process.env.YT_TEST_PORT ?? 8080);
const BASE_URL = process.env.YT_TEST_BASE_URL ?? `http://localhost:${PORT}`;
const ADMIN_LOGIN = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const ADMIN_PASSWORD = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const READY_TIMEOUT_MS = Number(process.env.YT_TEST_READY_TIMEOUT_MS ?? 600_000);
// A cache dir so repeated runs don't re-download ~1GB.
const CACHE_DIR = process.env.YT_TEST_CACHE_DIR ?? path.join(tmpdir(), 'yt-scp-cache');

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline((await import('node:fs')).createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(log, url, dest) {
  if (await exists(dest)) {
    if ((await sha256(dest)) === YT_SHA256) {
      log.info(`cached distribution is valid: ${dest}`);
      return;
    }
    log.warn('cached distribution failed checksum; re-downloading');
    await rm(dest, { force: true });
  }
  log.step(`download ${YT_VERSION} (~1GB)`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  const actual = await sha256(dest);
  if (actual !== YT_SHA256) throw new Error(`checksum mismatch: ${actual} != ${YT_SHA256}`);
  log.info('downloaded + verified');
}

/** Resolve a JDK home for YouTrack. Prefer $YT_TEST_JDK, else the bundled per-OS JRE. */
async function resolveJdk(log, ytHome) {
  if (process.env.YT_TEST_JDK) return process.env.YT_TEST_JDK;
  const plat = process.platform === 'linux' ? 'linux-x64' : process.platform === 'win32' ? 'windows-amd64' : 'mac-x64';
  const bundled = path.join(ytHome, 'internal', 'java', plat);
  if (await exists(bundled)) {
    log.info(`using bundled JRE: ${bundled}`);
    return bundled;
  }
  log.warn('no bundled JRE found; falling back to JAVA_HOME / system java');
  return process.env.JAVA_HOME ?? '';
}

function launcher(ytHome) {
  return spawnSync('sh', ['-c', `ls "${ytHome}"/launcher/lib/*-launcher.jar`], { encoding: 'utf8' })
    .stdout.trim();
}

function ytCmd(ytHome, jdk, args) {
  const jar = launcher(ytHome);
  const java = jdk ? path.join(jdk, 'bin', 'java') : 'java';
  return spawnSync(java, ['-jar', jar, ...args], { cwd: ytHome, encoding: 'utf8' });
}

function httpCode(url) {
  const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', url], {
    encoding: 'utf8',
  });
  return r.stdout.trim();
}

async function wizardPost(base, token, endpoint, body) {
  const res = await fetch(`${base}/api/wizard/${endpoint}?wizardToken=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.text();
}

runMain('provision:real-youtrack', async (log) => {
  assertDestructiveAllowed(log);
  assertNotProduction(BASE_URL, log);

  const runId = makeRunId();
  await mkdir(CACHE_DIR, { recursive: true });
  const archive = path.join(CACHE_DIR, `youtrack-${YT_VERSION}.zip`);
  await download(log, YT_DIST_URL, archive);

  log.step('extract distribution');
  const workDir = path.join(CACHE_DIR, `run-${runId}`);
  await mkdir(workDir, { recursive: true });
  const unzip = spawnSync('unzip', ['-q', '-o', archive, '-d', workDir], { encoding: 'utf8' });
  if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
  const ytHome = path.join(workDir, `youtrack-${YT_VERSION}`);

  const jdk = await resolveJdk(log, ytHome);
  if (jdk) ytCmd(ytHome, null, ['java', 'set', jdk]);

  log.step('configure + start');
  ytCmd(ytHome, jdk, ['configure', `--listen-port=${PORT}`, `--base-url=${BASE_URL}`]);
  ytCmd(ytHome, jdk, ['start']);

  log.step('await configuration wizard');
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (httpCode(`${BASE_URL}/`) !== '200') {
    if (Date.now() > deadline) throw new Error('timed out waiting for the wizard');
    spawnSync('sleep', ['3']);
  }

  const tokenFile = path.join(ytHome, 'conf', 'internal', 'services', 'configurationWizard', 'wizard_token.txt');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  log.info('wizard token acquired');

  log.step('headless wizard bootstrap');
  await wizardPost(BASE_URL, token, 'hub-settings', {
    disableInternalHub: false,
    rootUser: ADMIN_LOGIN,
    rootPassword: ADMIN_PASSWORD,
    allowAnonymousAccess: false,
  });
  const licenseDefault = await (
    await fetch(`${BASE_URL}/api/wizard/license-key/default?wizardToken=${token}`)
  ).json();
  await wizardPost(BASE_URL, token, 'license-key', licenseDefault);
  await wizardPost(BASE_URL, token, 'wait/dump', {});

  log.step('await application start (/api/config)');
  while (httpCode(`${BASE_URL}/api/config?fields=version`) !== '200') {
    if (Date.now() > deadline) {
      throw new Error(
        'timed out waiting for /api/config. On Apple-Silicon macOS the bundled Truffle ' +
          'scripting engine cannot start — run on Linux x64 (see header caveat).',
      );
    }
    spawnSync('sleep', ['5']);
  }
  log.info('YouTrack application is up');

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    mode: 'local-no-docker',
    distribution: { version: YT_VERSION, url: YT_DIST_URL, sha256: YT_SHA256 },
    baseUrl: BASE_URL,
    listenPort: PORT,
    ytHome,
    workDir,
    jdk,
    adminLogin: ADMIN_LOGIN,
  };
  await writeFile(
    path.join(ARTIFACTS_DIR, 'test-environment-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  // Record the home dir so cleanup can stop this exact instance.
  await writeFile(path.join(CACHE_DIR, 'last-run.json'), JSON.stringify({ ytHome, jdk, workDir }));
  log.info('base URL:', BASE_URL, '| admin:', ADMIN_LOGIN);
  log.warn(
    'Mint a permanent token in the UI (Profile > Account Security) or via Hub REST and ' +
      'export it as YT_TEST_ADMIN_TOKEN for the integration tests. // SPIKE: automate token mint.',
  );
  void readdir; // reserved for future orphan scans
  void stat;
});
