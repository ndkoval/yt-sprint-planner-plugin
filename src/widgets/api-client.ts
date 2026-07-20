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
  IssueView,
  UserSummary,
  ProjectFieldSummary,
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
 * The widget receives a `host` via `await YTApp.register()` exposing
 * `host.fetchApp(relativeUrl, {method, body, query})`, and the active project comes from
 * `YTApp.entity`. This is the ONLY place that touches the SDK. Confirmed working on
 * YouTrack 2025.3 (the installed widgets drive the backend through this path end to end).
 */
interface YouTrackHost {
  fetchApp(
    relativeUrl: string,
    options: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<unknown>;
}

interface YTAppGlobal {
  register?(): Promise<YouTrackHost>;
  // In a project context `entity` is the project; in an issue context it is the issue,
  // which carries its `project`. We accept either so the planner works from the project
  // settings tab, an issue action, or a dashboard/project-overview widget.
  entity?: { id?: string; project?: { id?: string } };
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
  // Dev fallback base path (standalone harness serves the backend here).
  private static readonly APP_BASE_PATH = '/api/apps/sprint-capacity-planner/backend';
  // Host mode: the tunnel endpoint, relative to the app. `backend` is the handler file
  // (backend.js at the package root), `api` is the endpoint path declared in it.
  private static readonly API_ENDPOINT = 'backend/api';

  private hostPromise: Promise<YouTrackHost | null> | null = null;

  private async host(): Promise<YouTrackHost | null> {
    if (this.hostPromise === null) {
      this.hostPromise = (async () => {
        const w = window as AppWindow;
        // Register with the host to obtain the app-scoped `host` (confirmed on 2025.3).
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
    // Resolve the project the widget is scoped to. In an issue context (issue-planner)
    // YTApp.entity is the issue, which carries its project (entity.project.id); in a project
    // context (project tab / settings) YTApp.entity is the project itself (entity.id). A
    // dashboard/standalone context without an entity falls back to an explicit ?projectId.
    // The planner is project-scoped, so a context with none surfaces a clear error the widget
    // renders as a message.
    const fromProject = w.YTApp?.entity?.project?.id;
    if (typeof fromProject === 'string' && fromProject.length > 0) return fromProject;
    const fromEntity = w.YTApp?.entity?.id;
    if (typeof fromEntity === 'string' && fromEntity.length > 0) return fromEntity;
    const fromQuery = new URLSearchParams(window.location.search).get('projectId');
    if (fromQuery !== null && fromQuery.length > 0) return fromQuery;
    throw new Error('Unable to resolve the current project id from the YouTrack host.');
  }

  async resolveUserId(): Promise<string | null> {
    const w = window as AppWindow;
    // The current viewer, exposed by the host on YTApp.me.
    const id = w.YTApp?.me?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  async fetch(path: string, init?: HostRequestInit): Promise<Response> {
    const host = await this.host();
    const body = init?.body !== undefined ? (JSON.parse(init.body) as unknown) : undefined;
    if (host) {
      // YouTrack app HTTP handlers only allow GET/POST/PUT/DELETE at fixed paths, so every
      // call is tunnelled as a POST to the single `api` endpoint carrying the real method +
      // app-relative path. The backend replies with `{ status, body }` (the transport is
      // always 200); we reconstruct a Response with the real status. The endpoint lives at
      // `<handlerFile>/api` where the handler file is `backend/index`. See backend/index.ts.
      const raw = (await host.fetchApp(`${WindowHostBridge.API_ENDPOINT}`, {
        method: 'POST',
        body: { method: init?.method ?? 'GET', path, ...(body !== undefined ? { body } : {}) },
      })) as { status?: number; body?: unknown } | null;
      const status = typeof raw?.status === 'number' ? raw.status : 200;
      return new Response(JSON.stringify(raw?.body ?? null), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Dev fallback: same-origin fetch against the mounted base path (standalone harness).
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

  /** Search users for the participant / assignee pickers. */
  searchUsers(query: string): Promise<UserSummary[]> {
    return this.request<UserSummary[]>('GET', `/users?query=${encodeURIComponent(query)}`);
  }

  /** Project custom fields for the effort-field pickers. */
  getProjectFields(): Promise<ProjectFieldSummary[]> {
    return this.request<ProjectFieldSummary[]>('GET', '/project-fields');
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

  /** The Sprint's issues (with assignee + effort) for the planning board. */
  listSprintIssues(sprintId: string): Promise<IssueView[]> {
    return this.request<IssueView[]>('GET', `/sprints/${encodeURIComponent(sprintId)}/issues`);
  }

  /** The backlog pool (configured search, minus issues already in the Sprint). */
  listBacklog(sprintId: string): Promise<IssueView[]> {
    return this.request<IssueView[]>('GET', `/sprints/${encodeURIComponent(sprintId)}/backlog`);
  }

  /**
   * Plan an issue (a board drag): pull it into/out of the Sprint and set its assignee in one
   * action. Returns the reconciled SprintView so capacity load/remaining refresh.
   */
  planIssue(
    sprintId: string,
    issueId: string,
    body: { inSprint: boolean; assigneeId: string | null },
  ): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/issues/${encodeURIComponent(issueId)}/plan`,
      body,
    );
  }

  /** Adjust an issue (Original/Current Effort + assignee) from the planner's issue dialog. */
  updateIssue(
    sprintId: string,
    issueId: string,
    body: {
      originalEffortMinutes?: number | null;
      currentEffortMinutes?: number | null;
      assigneeId?: string | null;
    },
  ): Promise<SprintView> {
    return this.request<SprintView>(
      'PATCH',
      `/sprints/${encodeURIComponent(sprintId)}/issues/${encodeURIComponent(issueId)}`,
      body,
    );
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

  resetUserCapacity(sprintId: string, userId: string, expectedRevision: number): Promise<SprintView> {
    return this.request<SprintView>(
      'POST',
      `/sprints/${encodeURIComponent(sprintId)}/capacity/${encodeURIComponent(userId)}/reset`,
      { expectedRevision },
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
