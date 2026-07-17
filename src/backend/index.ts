/**
 * YouTrack App backend entry point (manifest `backend.entryPoint`).
 *
 * This is a thin adapter: it constructs the {@link Router} with the real HTTP client
 * and maps YouTrack's HTTP handler request/response onto our transport-agnostic
 * {@link HttpRequest}/{@link HttpResponse}. All logic lives in {@link ./app.ts} and
 * the services so it stays unit/contract testable.
 *
 * SPIKE: the exact shape of YouTrack's app HTTP handler registration
 * (`exports.httpHandler`, endpoint objects, ctx/request/response API) must be
 * confirmed against the current Apps SDK on a real instance; the adapter below is
 * isolated so only this file changes when it is verified.
 */
import { createApp } from './app.js';
import type { HttpMethod, HttpRequest } from './http/router.js';
import { YouTrackHttpClient } from './repositories/youtrack-http-client.js';

/** Minimal shape of a YouTrack app HTTP request as seen by the handler. */
interface YtHttpRequest {
  method: string;
  path?: string;
  fullPath?: string;
  parameters?: Record<string, string> | { keys(): string[]; get(k: string): string };
  body?: string;
  json?: unknown;
}

/** Minimal shape of a YouTrack app HTTP response builder. */
interface YtHttpResponse {
  code: number;
  json(value: unknown): void;
}

function normaliseQuery(params: YtHttpRequest['parameters']): Record<string, string> {
  if (!params) return {};
  if (typeof (params as { keys?: unknown }).keys === 'function') {
    const p = params as { keys(): string[]; get(k: string): string };
    const out: Record<string, string> = {};
    for (const k of p.keys()) out[k] = p.get(k);
    return out;
  }
  return { ...(params as Record<string, string>) };
}

function toHttpRequest(req: YtHttpRequest): Omit<HttpRequest, 'params'> {
  const rawPath = req.path ?? req.fullPath ?? '/';
  const [path] = rawPath.split('?');
  let body: unknown = req.json;
  if (body === undefined && typeof req.body === 'string' && req.body.length > 0) {
    try {
      body = JSON.parse(req.body);
    } catch {
      body = undefined;
    }
  }
  return {
    method: req.method.toUpperCase() as HttpMethod,
    path: path ?? '/',
    query: normaliseQuery(req.parameters),
    body,
  };
}

// Build the app once per backend instance.
const app = createApp({ client: new YouTrackHttpClient() });

/**
 * Single catch-all endpoint delegating to the router. Registered under the app's
 * base path; the widgets call it with paths like `/sprints/143-7/capacity/me`.
 */
export const httpHandler = {
  endpoints: [
    {
      method: 'ALL',
      path: '/*',
      async handler(_ctx: unknown, request: YtHttpRequest, response: YtHttpResponse) {
        const result = await app.handle(toHttpRequest(request));
        response.code = result.status;
        response.json(result.body);
      },
    },
  ],
};

export { createApp };
