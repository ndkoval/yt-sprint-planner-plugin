/**
 * YouTrack App backend entry point (manifest `backend.entryPoint`).
 *
 * This is a thin adapter: it constructs the {@link Router} with the real HTTP client
 * and maps YouTrack's app HTTP handler `ctx` onto our transport-agnostic
 * {@link HttpRequest}/{@link HttpResponse}. All logic lives in {@link ./app.ts} and the
 * services so it stays unit/contract testable.
 *
 * YouTrack app HTTP handlers (verified against the 2025.3 Apps SDK) only support
 * GET/POST/PUT/DELETE with fixed, non-parameterised endpoint paths — but our API has many
 * parameterised routes (`/sprints/{id}/capacity/me`) and uses PATCH. So instead of one
 * endpoint per route, the widget POSTs an envelope `{ method, path, body }` to a single
 * `api` endpoint and we dispatch it through the router. The real HTTP status is returned
 * INSIDE the response envelope (`{ status, body }`) because the host's `fetchApp` transport
 * does not surface HTTP status codes. See {@link ../widgets/api-client.ts}.
 */
import { createApp } from './app.js';
import type { HttpMethod, HttpRequest } from './http/router.js';
import {
  YouTrackHttpClient,
  configureRuntimeConnection,
  setRuntimeStore,
  getRuntimeStore,
} from './repositories/youtrack-http-client.js';

/** The `ctx.request` YouTrack passes to an endpoint's `handle(ctx)`. */
interface YtRequest {
  method?: string;
  path?: string;
  fullPath?: string;
  body?: string;
  json(): unknown;
  getParameter(name: string): string | null;
}

/** The `ctx.response` builder. Status is the `code` property (there is no status()). */
interface YtResponse {
  code: number;
  json(value: unknown): void;
}

interface YtGlobalStorage {
  extensionProperties: Record<string, unknown>;
}

interface YtContext {
  request: YtRequest;
  response: YtResponse;
  settings?: Record<string, unknown>;
  globalStorage?: YtGlobalStorage;
  currentUser?: { login?: string; isSystem?: boolean } | null;
}

/** The envelope the widget sends: the real method + app-relative path (may carry ?query). */
interface RequestEnvelope {
  method?: string;
  path?: string;
  body?: unknown;
}

function parseQuery(queryString: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const pair of queryString.split('&')) {
    if (pair.length === 0) continue;
    const idx = pair.indexOf('=');
    const key = idx >= 0 ? pair.slice(0, idx) : pair;
    const value = idx >= 0 ? pair.slice(idx + 1) : '';
    query[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return query;
}

// Build the app once per backend instance.
const app = createApp({ client: new YouTrackHttpClient() });

/** Dispatch one tunnelled widget request through the router. */
async function handleApi(ctx: YtContext): Promise<void> {
  let envelope: RequestEnvelope = {};
  try {
    envelope = (ctx.request.json() as RequestEnvelope) ?? {};
  } catch {
    envelope = {};
  }

  // The backend runtime has no `fetch` and no automatic same-instance REST auth, so it
  // authenticates as the app with a token. The token is stored once in the app's global
  // storage via the `/__configure` control path (an admin sets it at provisioning time);
  // app settings are used as a fallback. KNOWN LIMITATION (security): the provisioned token is
  // admin-scoped and therefore over-privileged relative to the manifest's scopes; the token-free
  // long-term path is the Backend JS (entities) API. Mitigated by the write-once bootstrap below.
  // See youtrack-http-client.ts. Tracked follow-up.
  const store = ctx.globalStorage?.extensionProperties ?? {};
  if (envelope.path === '/__configure') {
    // Provisioning-only control path that stores the backend's app token in app storage.
    // Hardened against injection:
    //   - WRITE-ONCE: it only accepts a token when none is stored yet (first-run bootstrap
    //     during provisioning). Once set it is locked — reconfiguring requires reinstalling
    //     the app (which clears AppGlobalStorage). This removes the reconfigure attack surface.
    //   - The base URL is NEVER caller-supplied (that would be an SSRF / token-exfiltration
    //     vector); the backend always talks to its own instance via the runtime default
    //     (see runtimeBaseUrl / SCP_YT_BASE_URL in youtrack-http-client.ts).
    // KNOWN LIMITATION: this token bridge is a provisioning stopgap; the proper design is the
    // Backend JS (entities) API, which needs no stored token at all — tracked as follow-up.
    const alreadySet = typeof store.scpYoutrackToken === 'string' && store.scpYoutrackToken.length > 0;
    if (alreadySet) {
      ctx.response.code = 200;
      ctx.response.json({
        status: 409,
        body: { code: 'ALREADY_CONFIGURED', message: 'The app connection is already configured; reinstall to reset.' },
      });
      return;
    }
    const cfg = (envelope.body ?? {}) as { token?: unknown };
    if (typeof cfg.token === 'string' && cfg.token.length > 0) store.scpYoutrackToken = cfg.token;
    ctx.response.code = 200;
    ctx.response.json({ status: 200, body: { configured: true } });
    return;
  }
  const settings = ctx.settings ?? {};
  const token =
    (typeof store.scpYoutrackToken === 'string' ? store.scpYoutrackToken : null) ??
    (typeof settings.youtrackToken === 'string' ? settings.youtrackToken : null);
  // Base URL is the app's own instance — taken from the runtime (SCP_YT_BASE_URL / default),
  // never from the request, so a caller can't repoint the backend's REST calls.
  configureRuntimeConnection(null, token);

  // Load the app's extension-property state (one JSON blob in AppGlobalStorage) into the
  // client before dispatch, then write it back after so mutations persist.
  let state: Record<string, Record<string, string | number | boolean | null>> = {};
  if (typeof store.scpStateJson === 'string' && store.scpStateJson.length > 0) {
    try {
      state = JSON.parse(store.scpStateJson);
    } catch {
      state = {};
    }
  }
  setRuntimeStore(state);

  const rawPath = typeof envelope.path === 'string' && envelope.path.length > 0 ? envelope.path : '/';
  const qIndex = rawPath.indexOf('?');
  const pathOnly = qIndex >= 0 ? rawPath.slice(0, qIndex) : rawPath;
  const query = qIndex >= 0 ? parseQuery(rawPath.slice(qIndex + 1)) : {};
  const request: Omit<HttpRequest, 'params'> = {
    method: (envelope.method ?? 'GET').toUpperCase() as HttpMethod,
    path: pathOnly.length > 0 ? pathOnly : '/',
    query,
    body: envelope.body,
  };
  const result = await app.handle(request);
  // Persist any extension-property writes back to AppGlobalStorage.
  store.scpStateJson = JSON.stringify(getRuntimeStore());
  // Transport is always 200; the real status travels in the envelope.
  ctx.response.code = 200;
  ctx.response.json({ status: result.status, body: result.body });
}

/**
 * The app's HTTP handler. Exposed to YouTrack as `exports.httpHandler`; the bundle is a
 * root-level `backend.js`, so the endpoint is reachable at
 * `/api/extensionEndpoints/sprint-capacity-planner/backend/api`.
 */
export const httpHandler = {
  endpoints: [
    {
      scope: 'global',
      method: 'POST',
      path: 'api',
      handle: (ctx: YtContext): Promise<void> => handleApi(ctx),
    },
  ],
};

export { createApp };
