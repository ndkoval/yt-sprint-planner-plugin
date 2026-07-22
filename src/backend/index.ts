/**
 * YouTrack App backend entry point (bundled to `backend.js` at the package root).
 *
 * Endpoints are GLOBAL-scoped (they work identically from the project settings tab,
 * the issue action widget and the dashboard widget) and take the project KEY via the
 * `project` query parameter; the handler resolves the Project entity in-process with
 * `entities.Project.findByKey` and reads/writes its `scp*` extension properties. The
 * caller is `ctx.currentUser` — the real authenticated user — so authorization is
 * always server-side. No tokens, no REST-to-self.
 *
 * Responses always travel in a 200 envelope `{ok, data|error}` because the host's
 * `fetchApp` transport does not surface HTTP error bodies reliably (verified on 2025.3).
 */
import {
  capacityResetRequestSchema,
  capacityWriteRequestSchema,
  importRequestSchema,
  overrideFocusFactorRequestSchema,
  putConfigRequestSchema,
  registerSprintRequestSchema,
  savePrefsRequestSchema,
  setCalibrationRequestSchema,
} from '../shared/api-schemas.js';
import type { BackendEnvelope } from '../shared/api.js';
import { AppError, notFound, forbidden, toApiError } from './errors.js';
import type { BackendEnv, BackendProject, BackendUser } from './env.js';
import * as handlers from './handlers.js';
import { newCorrelationId } from './ids.js';

/** The `ctx.request` YouTrack passes to an endpoint's `handle(ctx)`. */
interface YtRequest {
  json(): unknown;
  getParameter(name: string): string | null;
}

/** The `ctx.response` builder. Status is the `code` property. */
interface YtResponse {
  code: number;
  json(value: unknown): void;
}

interface YtContext {
  request: YtRequest;
  response: YtResponse;
  /** The real authenticated caller (alias of entities.User.current). */
  currentUser?: {
    login?: string;
    fullName?: string;
    hasPermission?(permissionKey: string, project?: unknown): boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Real environment over the in-process scripting API.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- runtime-provided module */
let entitiesModule: any = null;
function entities(): any {
  if (entitiesModule === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS runtime
    entitiesModule = require('@jetbrains/youtrack-scripting-api/entities');
  }
  return entitiesModule;
}

function realEnv(): BackendEnv {
  return {
    findProjectByKey(key: string): BackendProject | null {
      const project = entities().Project.findByKey(key);
      if (!project) return null;
      return {
        key,
        leaderLogin: typeof project.leader?.login === 'string' ? project.leader.login : null,
        getProperty(name: string): string | null {
          const value = project.extensionProperties[name];
          return typeof value === 'string' && value.length > 0 ? value : null;
        },
        setProperty(name: string, value: string | null): void {
          project.extensionProperties[name] = value;
        },
        raw: project,
      };
    },
    findUserNameByLogin(login: string): string | null {
      const user = entities().User.findByLogin(login);
      if (!user) return null;
      return typeof user.fullName === 'string' && user.fullName.length > 0
        ? user.fullName
        : login;
    },
    now: () => Date.now(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function callerOf(ctx: YtContext): BackendUser {
  const u = ctx.currentUser;
  if (!u || typeof u.login !== 'string' || u.login.length === 0) {
    throw forbidden('No authenticated user.');
  }
  const login = u.login;
  const props = (u as { extensionProperties?: Record<string, unknown> }).extensionProperties;
  return {
    login,
    name: typeof u.fullName === 'string' && u.fullName.length > 0 ? u.fullName : login,
    // The app's manager role = YouTrack's own project-settings right, nothing custom.
    canUpdateProject: (project) => u.hasPermission?.('UPDATE_PROJECT', project.raw) === true,
    getProperty(name: string): string | null {
      const value = props?.[name];
      return typeof value === 'string' && value.length > 0 ? value : null;
    },
    setProperty(name: string, value: string | null): void {
      if (props) props[name] = value;
    },
  };
}

// ---------------------------------------------------------------------------
// Endpoint wiring
// ---------------------------------------------------------------------------

type Handle = (
  rctx: handlers.RequestContext,
  body: unknown,
  correlationId: string,
  param: (name: string) => string | null,
) => unknown;

function endpoint(method: 'GET' | 'POST', path: string, handle: Handle) {
  return {
    method,
    path,
    scope: 'global' as const,
    handle: (ctx: YtContext): void => {
      const correlationId = newCorrelationId(Date.now());
      try {
        const key = ctx.request.getParameter('project');
        if (!key) {
          throw new AppError('VALIDATION_FAILED', 'The project query parameter is required.');
        }
        const env = realEnv();
        const project = env.findProjectByKey(key);
        if (!project) throw notFound(`Project ${key}`);
        let body: unknown = null;
        if (method === 'POST') {
          try {
            body = ctx.request.json();
          } catch {
            body = null;
          }
        }
        const data = handle({ env, user: callerOf(ctx), project }, body, correlationId, (name) =>
          ctx.request.getParameter(name),
        );
        const envelope: BackendEnvelope<unknown> = { ok: true, data };
        ctx.response.json(envelope);
      } catch (err) {
        const error = toApiError(err, correlationId);
        console.error(
          `scp backend [${correlationId}] ${error.code}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        const envelope: BackendEnvelope<never> = { ok: false, error };
        ctx.response.json(envelope);
      }
    },
  };
}

/**
 * A project-INDEPENDENT endpoint (per-user preferences). Same envelope contract,
 * but no `project` query parameter and no Project resolution.
 */
function userEndpoint(
  method: 'GET' | 'POST',
  path: string,
  handle: (user: BackendUser, body: unknown) => unknown,
) {
  return {
    method,
    path,
    scope: 'global' as const,
    handle: (ctx: YtContext): void => {
      const correlationId = newCorrelationId(Date.now());
      try {
        let body: unknown = null;
        if (method === 'POST') {
          try {
            body = ctx.request.json();
          } catch {
            body = null;
          }
        }
        const envelope: BackendEnvelope<unknown> = { ok: true, data: handle(callerOf(ctx), body) };
        ctx.response.json(envelope);
      } catch (err) {
        const error = toApiError(err, correlationId);
        console.error(
          `scp backend [${correlationId}] ${error.code}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
        const envelope: BackendEnvelope<never> = { ok: false, error };
        ctx.response.json(envelope);
      }
    },
  };
}

export const httpHandler = {
  endpoints: [
    userEndpoint('GET', 'prefs', (user) => handlers.getPrefs(user)),
    userEndpoint('POST', 'prefs', (user, body) =>
      handlers.savePrefs(user, savePrefsRequestSchema.parse(body)),
    ),
    endpoint('GET', 'config', (rctx) => handlers.getConfig(rctx)),
    endpoint('POST', 'config', (rctx, body) =>
      handlers.putConfig(rctx, putConfigRequestSchema.parse(body)),
    ),
    endpoint('GET', 'sprint-data', (rctx, _body, _cid, param) =>
      handlers.getSprintData(rctx, param('team') ?? undefined),
    ),
    endpoint('POST', 'sprint-register', (rctx, body) =>
      handlers.registerSprint(rctx, registerSprintRequestSchema.parse(body)),
    ),
    endpoint('POST', 'capacity', (rctx, body) =>
      handlers.writeCapacity(rctx, capacityWriteRequestSchema.parse(body)),
    ),
    endpoint('POST', 'capacity-reset', (rctx, body) =>
      handlers.resetCapacity(rctx, capacityResetRequestSchema.parse(body)),
    ),
    endpoint('POST', 'focus-factor', (rctx, body) =>
      handlers.overrideFocusFactor(rctx, overrideFocusFactorRequestSchema.parse(body)),
    ),
    endpoint('POST', 'calibration', (rctx, body) =>
      handlers.setCalibration(rctx, setCalibrationRequestSchema.parse(body)),
    ),
    endpoint('GET', 'export', (rctx) => handlers.getExport(rctx)),
    endpoint('POST', 'import', (rctx, body) =>
      handlers.postImport(rctx, importRequestSchema.parse(body)),
    ),
    endpoint('GET', 'diagnostics', (rctx, _body, correlationId) =>
      handlers.getDiagnostics(rctx, correlationId),
    ),
  ],
};
