/**
 * A tiny method+path router, independent of the YouTrack HTTP SDK so it is fully
 * unit/contract testable. A thin adapter ({@link ../index.ts}) maps the SDK's request
 * object onto {@link HttpRequest} and back. Path patterns use `:param` segments.
 */
import { newCorrelationId } from '../ids.js';
import { AppError, statusFor, toApiError } from '../errors.js';
import type { Clock } from '../clock.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  /** Path without query string, e.g. "/sprints/143-7/capacity/me". */
  path: string;
  /** Parsed path parameters, filled by the router. */
  params: Record<string, string>;
  /** Parsed query parameters. */
  query: Record<string, string>;
  /** Parsed JSON body (unknown until validated). */
  body: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type Handler = (req: HttpRequest, correlationId: string) => Promise<HttpResponse>;

interface Route {
  method: HttpMethod;
  segments: string[];
  handler: Handler;
}

export function ok(body: unknown): HttpResponse {
  return { status: 200, body };
}
export function created(body: unknown): HttpResponse {
  return { status: 201, body };
}

export class Router {
  private readonly routes: Route[] = [];

  constructor(private readonly clock: Clock) {}

  add(method: HttpMethod, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: splitPath(pattern), handler });
    return this;
  }

  /** Match and dispatch a request, wrapping errors in the API error envelope. */
  async handle(req: Omit<HttpRequest, 'params'>): Promise<HttpResponse> {
    const correlationId = newCorrelationId(this.clock.now());
    const reqSegments = splitPath(req.path);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = matchSegments(route.segments, reqSegments);
      if (!params) continue;
      try {
        return await route.handler({ ...req, params }, correlationId);
      } catch (err) {
        return { status: statusFor(err), body: toApiError(err, correlationId) };
      }
    }
    const notFound = new AppError('NOT_FOUND', `No route for ${req.method} ${req.path}.`);
    return { status: notFound.status, body: toApiError(notFound, correlationId) };
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Return matched params if the route segments match the request, else null. */
function matchSegments(route: string[], actual: string[]): Record<string, string> | null {
  if (route.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < route.length; i += 1) {
    const r = route[i]!;
    const a = actual[i]!;
    if (r.startsWith(':')) {
      params[r.slice(1)] = decodeURIComponent(a);
    } else if (r !== a) {
      return null;
    }
  }
  return params;
}
