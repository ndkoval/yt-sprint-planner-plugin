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
  // app settings are used as a fallback. SPIKE/SECURITY: an admin-scoped token stored here
  // is over-privileged — the proper long-term path is the Backend JS (entities) API, which
  // needs no token. See youtrack-http-client.ts.
  const store = ctx.globalStorage?.extensionProperties ?? {};
  if (envelope.path === '/__configure') {
    // Store the backend's app token/base URL. Guarded because it would otherwise let any
    // authenticated user overwrite the token or repoint the base URL (token exfiltration):
    //   - only an administrator may RECONFIGURE once a token exists;
    //   - a first-run bootstrap (no token yet) is allowed so provisioning can set it;
    //   - the base URL must be a well-formed http(s) URL.
    // SECURITY/SPIKE: this token bridge is a stopgap; the proper design is the Backend JS
    // (entities) API, which needs no stored token at all.
    const alreadySet = typeof store.scpYoutrackToken === 'string' && store.scpYoutrackToken.length > 0;
    const isAdmin = ctx.currentUser?.isSystem === true;
    if (alreadySet && !isAdmin) {
      ctx.response.code = 200;
      ctx.response.json({ status: 403, body: { code: 'FORBIDDEN', message: 'Only an administrator can reconfigure the app connection.' } });
      return;
    }
    const cfg = (envelope.body ?? {}) as { token?: unknown; baseUrl?: unknown };
    if (typeof cfg.baseUrl === 'string') {
      if (!/^https?:\/\/[^\s/]+(?::\d+)?$/.test(cfg.baseUrl)) {
        ctx.response.code = 200;
        ctx.response.json({ status: 400, body: { code: 'VALIDATION_FAILED', message: 'baseUrl must be a http(s) origin.' } });
        return;
      }
      store.scpYoutrackBaseUrl = cfg.baseUrl;
    }
    if (typeof cfg.token === 'string') store.scpYoutrackToken = cfg.token;
    ctx.response.code = 200;
    ctx.response.json({ status: 200, body: { configured: true } });
    return;
  }
  const settings = ctx.settings ?? {};
  const token =
    (typeof store.scpYoutrackToken === 'string' ? store.scpYoutrackToken : null) ??
    (typeof settings.youtrackToken === 'string' ? settings.youtrackToken : null);
  const baseUrl =
    (typeof store.scpYoutrackBaseUrl === 'string' ? store.scpYoutrackBaseUrl : null) ??
    (typeof settings.youtrackBaseUrl === 'string' ? settings.youtrackBaseUrl : null);
  configureRuntimeConnection(baseUrl, token);

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
