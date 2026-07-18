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

interface YtContext {
  request: YtRequest;
  response: YtResponse;
  settings?: Record<string, unknown>;
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
  // The backend has no fetch and no automatic same-instance REST auth, so authenticate
  // as the app using a token + base URL from app settings (see youtrack-http-client.ts).
  const settings = ctx.settings ?? {};
  const token = typeof settings.youtrackToken === 'string' ? settings.youtrackToken : null;
  const baseUrl = typeof settings.youtrackBaseUrl === 'string' ? settings.youtrackBaseUrl : null;
  configureRuntimeConnection(baseUrl, token);

  let envelope: RequestEnvelope = {};
  try {
    envelope = (ctx.request.json() as RequestEnvelope) ?? {};
  } catch {
    envelope = {};
  }
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
