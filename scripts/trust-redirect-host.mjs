/**
 * trust-redirect-host — register a host as a trusted OAuth redirect address on the YouTrack
 * Hub service, so a browser reaching YouTrack from that host doesn't hit the "resource address
 * is not registered as a trusted access address" OAuth error.
 *
 * The demo reels are recorded from inside a Docker container that reaches the host YouTrack at
 * `host.docker.internal:8080`, but YouTrack was configured with base URL `localhost:8080`, so
 * that origin must be added to the service's redirectUris. Idempotent; safe to re-run.
 *
 * Auth: the root admin's basic credentials (managing Hub services needs the Hub scope, which
 * the app/YouTrack-scoped token does not have). Env:
 *   YT_TEST_BASE_URL (default http://localhost:8080)  — where THIS script reaches Hub (REST)
 *   YT_TEST_MANAGER_LOGIN / YT_TEST_MANAGER_PASSWORD   — root admin basic creds
 *   RECORD_HOST (default http://host.docker.internal:8080) — origin(s) to trust, comma-separated
 */
import { runMain } from './lib/log.mjs';

const BASE = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const LOGIN = process.env.YT_TEST_MANAGER_LOGIN ?? 'admin';
const PASSWORD = process.env.YT_TEST_MANAGER_PASSWORD ?? 'adminPass123!';
const HOSTS = (process.env.RECORD_HOST ?? 'http://host.docker.internal:8080')
  .split(',')
  .map((h) => h.trim().replace(/\/$/, ''))
  .filter(Boolean);

const basic = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
const headers = {
  Authorization: `Basic ${basic}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/** The redirect-URI variants YouTrack registers per trusted origin. */
function variants(origin) {
  return [origin, `${origin}/oauth`, `${origin}/oauth?v2`, `${origin}/admin/hub`];
}

runMain('trust-redirect-host', async (log) => {
  const svcRes = await fetch(
    `${BASE}/hub/api/rest/services?query=applicationName:YouTrack&fields=id,redirectUris`,
    { headers },
  );
  const svc = (await svcRes.json())?.services?.find(() => true);
  if (!svc?.id) throw new Error('YouTrack Hub service not found (check admin credentials).');

  // redirectUris is a plain string array on this version.
  const current = (svc.redirectUris ?? []).map((u) => (typeof u === 'string' ? u : u.url));
  const wanted = HOSTS.flatMap(variants);
  const missing = wanted.filter((u) => !current.includes(u));
  if (missing.length === 0) {
    log.info('all recording hosts already trusted:', HOSTS.join(', '));
    return;
  }

  const merged = [...new Set([...current, ...wanted])];
  const upd = await fetch(`${BASE}/hub/api/rest/services/${svc.id}?fields=id,redirectUris`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ redirectUris: merged }),
  });
  if (!upd.ok) {
    throw new Error(`failed to update redirectUris: HTTP ${upd.status} ${(await upd.text()).slice(0, 200)}`);
  }
  log.info(`trusted ${missing.length} redirect URI(s) for: ${HOSTS.join(', ')}`);
});
