/**
 * Shared helpers for the YouTrack integration tests (§25).
 *
 * Provides a small fetch-based REST client (mirroring the backend's
 * FetchRestConnection) and per-suite isolation naming + cleanup, so integration
 * specs never touch shared/global data and always tear down after themselves.
 *
 * Every spec must call `describeIntegration(...)` (or guard with `hasInstance`) so the
 * suite self-skips when YT_TEST_BASE_URL is unset.
 */
import { describe } from 'vitest';

export const hasInstance = Boolean(process.env.YT_TEST_BASE_URL);

export interface IntegrationEnv {
  baseUrl: string;
  adminToken: string;
  projectPrefix: string;
  allowDestructive: boolean;
}

export function readEnv(): IntegrationEnv {
  return {
    baseUrl: process.env.YT_TEST_BASE_URL ?? '',
    adminToken: process.env.YT_TEST_ADMIN_TOKEN ?? '',
    projectPrefix: process.env.YT_TEST_PROJECT_PREFIX ?? 'SCP_E2E',
    allowDestructive: process.env.YT_TEST_ALLOW_DESTRUCTIVE === 'true',
  };
}

/** describe() that skips the whole suite unless a YouTrack instance is configured. */
export const describeIntegration: typeof describe.skip = hasInstance ? describe : describe.skip;

/** Isolation id per §25.3 — sortable timestamp + random suffix. */
export function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}`;
}

type Json = unknown;

/** Minimal fetch REST client (Bearer token + JSON), matching FetchRestConnection. */
export class RestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private toUrl(apiPath: string, query?: Record<string, string>): string {
    const u = new URL(apiPath.replace(/^\//, ''), this.baseUrl.replace(/\/?$/, '/'));
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async request(
    method: string,
    apiPath: string,
    opts: { query?: Record<string, string>; body?: Json } = {},
  ): Promise<Json> {
    const res = await fetch(this.toUrl(apiPath, opts.query), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`YouTrack REST ${method} ${apiPath} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    return text.length > 0 ? (JSON.parse(text) as Json) : null;
  }

  get(apiPath: string, query?: Record<string, string>): Promise<Json> {
    return this.request('GET', apiPath, { query });
  }
  post(apiPath: string, body: Json, query?: Record<string, string>): Promise<Json> {
    return this.request('POST', apiPath, { body, query });
  }
  del(apiPath: string, query?: Record<string, string>): Promise<Json> {
    return this.request('DELETE', apiPath, { query });
  }
}

export function makeClient(): RestClient {
  const env = readEnv();
  return new RestClient(env.baseUrl, env.adminToken);
}

/** Read a string field off a dynamically-shaped REST object without using `any`. */
export function field(obj: Json, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    return v === undefined || v === null ? undefined : String(v);
  }
  return undefined;
}
