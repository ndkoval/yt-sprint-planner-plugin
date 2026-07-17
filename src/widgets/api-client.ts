/**
 * Typed HTTP client for the Sprint Capacity Planner backend (§18).
 *
 * The backend exposes a single catch-all endpoint under the app's base path and the
 * widgets call it with paths like `/sprints/143-7/capacity/me`. Every call is scoped
 * to a project via `?projectId=…`, and every non-2xx response is an {@link ApiError}
 * envelope which we surface as a typed {@link ApiClientError}.
 *
 * The transport is isolated behind {@link HostBridge} because YouTrack embeds widgets
 * in an iframe and exposes an SDK-specific host object to reach the app backend and
 * learn the current project id. Swapping SDK versions should only touch the bridge.
 */
import type {
  ConfigResponse,
  ConfigValidationResponse,
  CreateNextSprintRequest,
  DiagnosticsResponse,
  ExcludeCalibrationRequest,
  OverrideFocusFactorRequest,
  PatchCapacityRequest,
  PatchSprintDetailsRequest,
  PutConfigRequest,
  SprintSummary,
  SprintView,
  ApiError,
  ApiErrorCode,
  BoardSummary,
} from '../shared/api';

/** RequestInit-like options the bridge understands (a subset of fetch's). */
export interface HostRequestInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * The seam between the widgets and the YouTrack host page. A real implementation
 * wraps the Apps SDK host object; tests can supply a fake.
 */
export interface HostBridge {
  /** The current project id the widget is rendered for. */
  resolveProjectId(): Promise<string>;
  /** The current viewer's stable user id, or null when the host cannot provide it. */
  resolveUserId(): Promise<string | null>;
  /** Perform an app-backend request for an app-relative `path`. Returns the raw Response. */
  fetch(path: string, init?: HostRequestInit): Promise<Response>;
}

/**
 * Minimal shape of the YouTrack Apps host object exposed on `window`.
 *
 * SPIKE: confirm host API — the exact global name and method signatures depend on the
 * current YouTrack Apps SDK. On recent SDKs the widget receives a `host` via
 * `await YTApp.register()` exposing `host.fetchApp(relativeUrl, {method, body, query})`
 * and the active project is available from `YTApp.entity` / `host.project`. This is the
 * ONLY place that touches the SDK; verify against a real instance and adjust here.
 */
interface YouTrackHost {
  fetchApp(
    relativeUrl: string,
    options: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<unknown>;
}

interface YTAppGlobal {
  register?(): Promise<YouTrackHost>;
  entity?: { id?: string };
  locationId?: string;
  me?: { id?: string };
}

interface AppWindow extends Window {
  YTApp?: YTAppGlobal;
}

/** Error thrown for any non-2xx backend response, carrying the structured envelope. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly correlationId: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.details = error.details;
  }

  /** True when the failure is an optimistic-concurrency conflict (§ concurrency). */
  get isConflict(): boolean {
    return this.code === 'CAPACITY_REVISION_CONFLICT' || this.code === 'CONFIG_REVISION_CONFLICT';
  }
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'string' && typeof v.message === 'string';
}

/**
 * Default {@link HostBridge} reading the YouTrack host object from `window`. Falls back
 * to a same-origin `fetch` against `APP_BASE_PATH` so the widget still works when served
 * outside the iframe during local development.
 */
export class WindowHostBridge implements HostBridge {
  // SPIKE: confirm host API — the base path the app backend is mounted under.
  private static readonly APP_BASE_PATH = '/api/apps/sprint-capacity-planner/backend';

  private hostPromise: Promise<YouTrackHost | null> | null = null;

  private async host(): Promise<YouTrackHost | null> {
    if (this.hostPromise === null) {
      this.hostPromise = (async () => {
        const w = window as AppWindow;
        // SPIKE: confirm host API — registration handshake with the SDK.
        if (w.YTApp?.register) {
          try {
            return await w.YTApp.register();
          } catch {
            return null;
          }
        }
        return null;
      })();
    }
    return this.hostPromise;
  }

  async resolveProjectId(): Promise<string> {
    const w = window as AppWindow;
    // SPIKE: confirm host API — the active project id source.
    const fromEntity = w.YTApp?.entity?.id ?? w.YTApp?.locationId;
    if (typeof fromEntity === 'string' && fromEntity.length > 0) return fromEntity;
    const fromQuery = new URLSearchParams(window.location.search).get('projectId');
    if (fromQuery !== null && fromQuery.length > 0) return fromQuery;
    throw new Error('Unable to resolve the current project id from the YouTrack host.');
  }

  async resolveUserId(): Promise<string | null> {
    const w = window as AppWindow;
    // SPIKE: confirm host API — the current viewer id source.
    const id = w.YTApp?.me?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  async fetch(path: string, init?: HostRequestInit): Promise<Response> {
    const host = await this.host();
    const body = init?.body !== undefined ? (JSON.parse(init.body) as unknown) : undefined;
    if (host) {
      // SPIKE: confirm host API — fetchApp signature + how it surfaces status codes.
      const raw = await host.fetchApp(path, {
        ...(init?.method !== undefined ? { method: init.method } : {}),
        ...(body !== undefined ? { body } : {}),
      });
      return new Response(JSON.stringify(raw ?? null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Dev fallback: same-origin fetch against the mounted base path.
    const url = `${WindowHostBridge.APP_BASE_PATH}${path}`;
    return window.fetch(url, {
      method: init?.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
  }
}

/** Typed client bound to a {@link HostBridge}. */
export class ApiClient {
  private projectIdCache: string | null = null;

  constructor(private readonly bridge: HostBridge = new WindowHostBridge()) {}

  /** The current viewer's user id, or null when the host cannot provide it. */
  resolveUserId(): Promise<string | null> {
    return this.bridge.resolveUserId();
  }

  private async projectId(): Promise<string> {
    if (this.projectIdCache === null) {
      this.projectIdCache = await this.bridge.resolveProjectId();
    }
    return this.projectIdCache;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const projectId = await this.projectId();
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `${path}${sep}projectId=${encodeURIComponent(projectId)}`;
    const init: HostRequestInit = { method };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.bridge.fetch(fullPath, init);
    const text = await response.text();
    const payload: unknown = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      if (isApiError(payload)) throw new ApiClientError(response.status, payload);
      throw new ApiClientError(response.status, {
        code: 'INTERNAL_ERROR',
        message: `Request failed with status ${response.status}.`,
        details: {},
        correlationId: '',
      });
    }
    return payload as T;
  }

  // --- Configuration -------------------------------------------------------

  getConfig(): Promise<ConfigResponse> {
    return this.request<ConfigResponse>('GET', '/config');
  }

  putConfig(body: PutConfigRequest): Promise<ConfigResponse> {
    return this.request<ConfigResponse>('PUT', '/config', body);
  }

  validateConfig(): Promise<ConfigValidationResponse> {
    return this.request<ConfigValidationResponse>('GET', '/config/validation');
  }

  getBoards(): Promise<BoardSummary[]> {
    return this.request<BoardSummary[]>('GET', '/boards');
  }

  // --- Sprints -------------------------------------------------------------

  listSprints(): Promise<SprintSummary[]> {
    return this.request<SprintSummary[]>('GET', '/sprints');
  }

  getSprint(sprintId: string): Promise<SprintView> {
    return this.request<SprintView>('GET', `/sprints/${encodeURIComponent(sprintId)}`);
  }

  createNextSprint(body: CreateNextSprintRequest): Promise<SprintView> {
    return this.request<SprintView>('POST', '/sprints/create-next', body);
  }

  patchSprintDetails(sprintId: string, body: PatchSprintDetailsRequest): Promise<SprintView> {
    return this.request<SprintView>(
      'PATCH',
      `/sprints/${encodeURIComponent(sprintId)}/details`,
      body,
    );
  }

  recalculate(sprintId: string): Promise<SprintView> {
    return this.request<SprintView>('POST', `/sprints/${encodeURIComponent(sprintId)}/recalculate`);
  }

  // --- Capacity ------------------------------------------------------------

  patchMyCapacity(sprintId: string, body: PatchCapacityRequest): Promise<SprintView> {
    return this.request<SprintView>(
      'PATCH',
      `/sprints/${encodeURIComponent(sprintId)}/capacity/me`,
      body,
    );
  }

  patchUserCapacity(
    sprintId: string,
    userId: string,
    body: PatchCapacityRequest,
  ): Promise<SprintView> {
    return this.request<SprintView>(
      'PATCH',
      `/sprints/${encodeURIComponent(sprintId)}/capacity/${encodeURIComponent(userId)}`,
      body,
    );
  }

  resetUserCapacity(sprintId: string, userId: string): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/capacity/${encodeURIComponent(userId)}/reset`,
    );
  }

  // --- Focus factor / calibration -----------------------------------------

  overrideFocusFactor(sprintId: string, body: OverrideFocusFactorRequest): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/focus-factor/override`,
      body,
    );
  }

  excludeFromCalibration(sprintId: string, body: ExcludeCalibrationRequest): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/calibration/exclude`,
      body,
    );
  }

  includeInCalibration(sprintId: string): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/calibration/include`,
    );
  }

  // --- Diagnostics (manager-only) -----------------------------------------

  getDiagnostics(): Promise<DiagnosticsResponse> {
    return this.request<DiagnosticsResponse>('GET', '/diagnostics');
  }
}
