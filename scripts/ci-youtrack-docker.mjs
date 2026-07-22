/**
 * ci-youtrack-docker — bring up a REAL YouTrack in Docker and run its first-run configuration
 * wizard headlessly, ending with an `/api`-serving instance plus a permanent admin token.
 *
 * The token is written to /tmp/yt25-token.txt AND /tmp/yt25-hubtoken.txt — the exact paths the
 * demo/seed/install scripts already read as a fallback — so every downstream step
 * (install-app, seed, record) works unchanged with no extra glue. Built for CI (Linux x64,
 * where the Apple-Silicon Truffle limitation does not apply) but runs anywhere Docker does.
 *
 * The wizard REST flow (hub-settings → license-key → wait/dump) and the Hub token mint are the
 * same ones verified end-to-end in scripts/provision-youtrack.mjs; here the wizard token comes
 * from the container (its startup logs, or the wizard_token.txt inside it) instead of a local
 * filesystem path.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';

// Default: the newest YouTrack release the suite is verified against (bump
// deliberately — the 00-platform spec pins the version the run actually saw).
const IMAGE = process.env.YT_IMAGE ?? 'jetbrains/youtrack:2026.2.17765';
const CONTAINER = process.env.YT_CONTAINER ?? 'youtrack-ci';
const PORT = Number(process.env.YT_TEST_PORT ?? 8080);
const BASE_URL = process.env.YT_TEST_BASE_URL ?? `http://localhost:${PORT}`;
const ADMIN_LOGIN = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const ADMIN_PASSWORD = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const READY_TIMEOUT_MS = Number(process.env.YT_TEST_READY_TIMEOUT_MS ?? 600_000);
const TOKEN_FILE = process.env.YT_TOKEN_FILE ?? '/tmp/yt25-token.txt';
const HUB_TOKEN_FILE = process.env.YT_HUB_TOKEN_FILE ?? '/tmp/yt25-hubtoken.txt';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function httpCode(url) {
  return sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5', url]).stdout.trim();
}

async function wizardPost(base, token, endpoint, body) {
  const res = await fetch(`${base}/api/wizard/${endpoint}?wizardToken=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.text();
}

/** The wizard token from the container: its startup logs, else the wizard_token.txt file. */
function getWizardToken(log) {
  const logs = sh('docker', ['logs', CONTAINER]).stdout + sh('docker', ['logs', CONTAINER]).stderr;
  const m =
    logs.match(/[?&]wizardToken=([A-Za-z0-9._-]+)/) ||
    logs.match(/wizard[_-]?token["'=:\s]+([A-Za-z0-9._-]{8,})/i);
  if (m) return m[1];
  const found = sh('docker', [
    'exec',
    CONTAINER,
    'sh',
    '-lc',
    'cat "$(find / -name wizard_token.txt 2>/dev/null | head -1)" 2>/dev/null',
  ]).stdout.trim();
  if (found) return found;
  log.warn('wizard token not found yet');
  return null;
}

/**
 * Mint a permanent token via Hub REST (admin basic-auth) scoped to BOTH the YouTrack service
 * (app tunnel + YouTrack REST) AND the Hub service `0-0-0-0-0` (so the seed can create users
 * via /hub/api/rest/users). A YouTrack-only token gets 401 on Hub admin operations.
 */
async function mintAdminToken(base, login, password, log) {
  const basic = Buffer.from(`${login}:${password}`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const HUB_SERVICE_ID = '0-0-0-0-0';
  try {
    const svcRes = await fetch(
      `${base}/hub/api/rest/services?fields=id,applicationName&query=applicationName:YouTrack`,
      { headers },
    );
    const svc = (await svcRes.json())?.services?.find((s) => s.applicationName === 'YouTrack');
    if (!svc) return null;
    const scope = [{ id: svc.id }, { id: HUB_SERVICE_ID }];
    const tokRes = await fetch(`${base}/hub/api/rest/users/me/permanenttokens?fields=token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `scp-ci-${Date.now()}`, scope }),
    });
    const tok = await tokRes.json();
    return typeof tok?.token === 'string' ? tok.token : null;
  } catch (err) {
    log.warn(`token mint failed: ${String(err).slice(0, 160)}`);
    return null;
  }
}

runMain('ci-youtrack-docker', async (log) => {
  // Fresh container (data lives inside it; discarded on teardown — fine for CI).
  sh('docker', ['rm', '-f', CONTAINER]);
  log.step(`start ${IMAGE} as ${CONTAINER} on :${PORT}`);
  const run = sh('docker', ['run', '-d', '--name', CONTAINER, '-p', `${PORT}:8080`, IMAGE]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);

  const deadline = Date.now() + READY_TIMEOUT_MS;

  log.step('await configuration wizard (HTTP 200 on /)');
  while (httpCode(`${BASE_URL}/`) !== '200') {
    if (Date.now() > deadline) throw new Error('timed out waiting for the wizard');
    await sleep(3000);
  }

  log.step('acquire wizard token');
  let token = null;
  while (token === null) {
    token = getWizardToken(log);
    if (token) break;
    if (Date.now() > deadline) throw new Error('timed out acquiring the wizard token');
    await sleep(3000);
  }
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
    if (Date.now() > deadline) throw new Error('timed out waiting for /api/config');
    await sleep(5000);
  }
  log.info('YouTrack application is up');

  log.step('mint permanent admin token (Hub REST)');
  const adminToken = await mintAdminToken(BASE_URL, ADMIN_LOGIN, ADMIN_PASSWORD, log);
  if (!adminToken) throw new Error('could not mint an admin token');
  // Both files: the app/seed scripts read yt25-token.txt; user creation reads yt25-hubtoken.txt
  // (admin is root, so the same YouTrack-service token also authorises Hub user creation).
  await writeFile(TOKEN_FILE, adminToken);
  await writeFile(HUB_TOKEN_FILE, adminToken);
  log.info('admin token minted →', TOKEN_FILE, '+', HUB_TOKEN_FILE);

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(
    path.join(ARTIFACTS_DIR, 'ci-youtrack.json'),
    JSON.stringify(
      { mode: 'docker', image: IMAGE, container: CONTAINER, baseUrl: BASE_URL, adminLogin: ADMIN_LOGIN },
      null,
      2,
    ),
  );
  log.info('base URL:', BASE_URL, '| admin:', ADMIN_LOGIN);
});
