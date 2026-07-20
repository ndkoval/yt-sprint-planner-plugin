/**
 * Shared env parsing, safety guards, and a fetch-based YouTrack REST client for the
 * YouTrack integration harness. Mirrors FetchRestConnection in
 * src/backend/repositories/youtrack-http-client.ts (Bearer token, JSON, /api paths).
 *
 * SAFETY: destructive provisioning/seeding/cleanup only proceeds when
 * YT_TEST_ALLOW_DESTRUCTIVE=true, and production-looking base URLs are hard-blocked.
 */

/** Read all recognised YT_TEST_* env vars into a plain object. */
export function readEnv() {
  return {
    baseUrl: process.env.YT_TEST_BASE_URL ?? '',
    adminToken: process.env.YT_TEST_ADMIN_TOKEN ?? '',
    managerLogin: process.env.YT_TEST_MANAGER_LOGIN ?? '',
    managerPassword: process.env.YT_TEST_MANAGER_PASSWORD ?? '',
    aliceLogin: process.env.YT_TEST_ALICE_LOGIN ?? '',
    alicePassword: process.env.YT_TEST_ALICE_PASSWORD ?? '',
    bobLogin: process.env.YT_TEST_BOB_LOGIN ?? '',
    bobPassword: process.env.YT_TEST_BOB_PASSWORD ?? '',
    projectPrefix: process.env.YT_TEST_PROJECT_PREFIX ?? 'SCP_E2E',
    allowDestructive: process.env.YT_TEST_ALLOW_DESTRUCTIVE === 'true',
  };
}

/** Throw unless destructive operations are explicitly allowed. */
export function assertDestructiveAllowed(log) {
  const env = readEnv();
  if (!env.allowDestructive) {
    throw new Error(
      'Refusing to run: destructive operations require YT_TEST_ALLOW_DESTRUCTIVE=true. ' +
        'This gate protects against accidental provisioning/cleanup against a YouTrack instance.',
    );
  }
  log.info('destructive operations allowed (YT_TEST_ALLOW_DESTRUCTIVE=true)');
  return env;
}

/**
 * Hard-block anything that does not look like a local/disposable instance.
 * Only localhost / 127.0.0.1 / [::1] (and *.local by opt-in) are permitted unless
 * YT_TEST_ALLOW_NONLOCAL=true is ALSO set — which is intentionally undocumented and
 * for advanced disposable-CI use only.
 */
export function assertNotProduction(baseUrl, log) {
  if (!baseUrl) {
    throw new Error('YT_TEST_BASE_URL is required');
  }
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`YT_TEST_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
  const isLocal = localHosts.has(host) || host.endsWith('.local');
  if (!isLocal && process.env.YT_TEST_ALLOW_NONLOCAL !== 'true') {
    throw new Error(
      `Refusing to target non-local host "${host}". The harness only launches/targets a ` +
        'local YouTrack instance. Production URLs are hard-blocked.',
    );
  }
  // Extra belt-and-braces: obvious production signals are always blocked.
  if (/youtrack\.cloud$|\.jetbrains\./i.test(host)) {
    throw new Error(`Refusing to target what looks like a hosted/production host: ${host}`);
  }
  log.info(`target host "${host}" accepted as local/disposable`);
}

/** Generate a run id: sortable timestamp + short random suffix (per §25.3). */
export function makeRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

/** Fetch-based REST client mirroring the backend's FetchRestConnection. */
export class YtRest {
  constructor(baseUrl, token, log) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.log = log;
  }

  url(path, query) {
    const u = new URL(path.replace(/^\//, ''), this.baseUrl.replace(/\/?$/, '/'));
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  async request(method, path, { query, body } = {}) {
    const res = await fetch(this.url(path, query), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`YouTrack REST ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    return text.length > 0 ? JSON.parse(text) : null;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }
  post(path, body, query) {
    return this.request('POST', path, { body, query });
  }
  del(path, query) {
    return this.request('DELETE', path, { query });
  }

  /** Poll GET /api/users/me until it succeeds or the timeout elapses. */
  async waitUntilReady(timeoutMs = 180000, intervalMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
      try {
        const me = await this.get('/api/users/me', { fields: 'id,login' });
        this.log.info('YouTrack reachable; authenticated as', me && me.login);
        return true;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(`YouTrack not ready within ${timeoutMs}ms: ${lastErr}`);
  }
}
