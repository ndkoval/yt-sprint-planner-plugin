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
 * PLATFORM NOTE (Apple Silicon): the newer 148xxx builds (YouTrack 2024.2/2024.3/2025.1)
 * bundle GraalVM/Truffle 22.0.0.2, whose scripting engine cannot initialise on arm64
 * macOS (no arm64 Truffle runtime; the fallback calls the removed
 * `sun.misc.Unsafe.ensureClassInitialized`), so those builds crash on start regardless of
 * JDK. The default below (2024.1.34109) PREDATES that engine and BOOTS on arm64 via the
 * bundled `internal/java/mac-x64` runtime under Rosetta 2 — verified locally: full wizard
 * bootstrap, `/api/config` → 200, agile board + sprints + issues via REST, and the real
 * Kanban board renders in-browser. Override YT_VERSION/YT_DIST_URL to try other builds.
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

// Pinned build — a standalone (non-Docker) distribution that BOOTS on arm64 macOS.
// 2024.1.34109 predates the GraalVM/Truffle 22 engine that breaks on Apple Silicon (see
// header). Overridable via env: YT_VERSION, YT_DIST_URL, YT_SHA256 (SHA optional when
// overriding — warns instead of failing).
const YT_VERSION = process.env.YT_VERSION ?? '2024.1.34109';
const YT_DIST_URL =
  process.env.YT_DIST_URL ?? `https://download.jetbrains.com/charisma/youtrack-${YT_VERSION}.zip`;
const YT_SHA256 =
  process.env.YT_SHA256 ?? 'c458bc0c4779362ef1a0ec932c57502f69496aa2667a49bdb0e07367b09c85ce';
// Strict checksum only when the pinned default (or an explicit YT_SHA256) is in force; a
// bare YT_VERSION override with no SHA warns instead of failing.
const YT_SHA_STRICT = process.env.YT_VERSION ? process.env.YT_SHA256 !== undefined : true;

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
  const verify = async (file) => {
    const actual = await sha256(file);
    if (actual === YT_SHA256) return true;
    if (YT_SHA_STRICT) throw new Error(`checksum mismatch: ${actual} != ${YT_SHA256}`);
    log.warn(`checksum not pinned for ${YT_VERSION} (got ${actual}); continuing`);
    return true;
  };
  if (await exists(dest)) {
    if (!YT_SHA_STRICT || (await sha256(dest)) === YT_SHA256) {
      log.info(`cached distribution present: ${dest}`);
      return;
    }
    log.warn('cached distribution failed checksum; re-downloading');
    await rm(dest, { force: true });
  }
  log.step(`download ${YT_VERSION} (~1GB)`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  await verify(dest);
  log.info('downloaded');
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

  log.step('mint permanent admin token (Hub REST)');
  const adminToken = await mintAdminToken(BASE_URL, ADMIN_LOGIN, ADMIN_PASSWORD, log);
  if (adminToken) log.info('admin token minted');
  else log.warn('could not mint token automatically; mint via Profile > Account Security');

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
    adminToken: adminToken ?? null,
  };
  await writeFile(
    path.join(ARTIFACTS_DIR, 'test-environment-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  // Record the home dir so cleanup can stop this exact instance.
  await writeFile(path.join(CACHE_DIR, 'last-run.json'), JSON.stringify({ ytHome, jdk, workDir }));
  log.info('base URL:', BASE_URL, '| admin:', ADMIN_LOGIN);
  if (adminToken) log.info(`export YT_TEST_ADMIN_TOKEN='${adminToken}'  YT_TEST_BASE_URL='${BASE_URL}'`);
  void readdir; // reserved for future orphan scans
  void stat;
});

/**
 * Mint a permanent YouTrack API token via Hub REST using the admin's basic-auth
 * credentials (scoped to the YouTrack service). Verified against 2024.1. Returns the
 * token string, or null on failure.
 */
async function mintAdminToken(base, login, password, log) {
  const basic = Buffer.from(`${login}:${password}`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  try {
    const svcRes = await fetch(
      `${base}/hub/api/rest/services?fields=id,applicationName&query=applicationName:YouTrack`,
      { headers },
    );
    const svc = (await svcRes.json())?.services?.find((s) => s.applicationName === 'YouTrack');
    if (!svc) return null;
    const tokRes = await fetch(`${base}/hub/api/rest/users/me/permanenttokens?fields=token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `scp-provision-${Date.now()}`, scope: [{ id: svc.id }] }),
    });
    const tok = await tokRes.json();
    return typeof tok?.token === 'string' ? tok.token : null;
  } catch (err) {
    log.warn(`token mint failed: ${String(err).slice(0, 120)}`);
    return null;
  }
}
