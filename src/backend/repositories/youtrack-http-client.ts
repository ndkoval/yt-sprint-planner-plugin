/**
 * Real {@link YouTrackClient} over the YouTrack REST API.
 *
 * SPIKE: In a deployed app the authenticated connection is provided by the Apps SDK
 * (e.g. `ctx.globalStorage` / an app-scoped HTTP connection with the app's service
 * token). The exact object and its auth are SDK-specific and must be confirmed on a
 * real instance. To keep this unit-testable and decoupled, the client talks to a
 * small {@link RestConnection} interface; the default implementation uses `fetch`
 * against a base URL + token from the environment, which is what the local
 * integration harness (§25) uses. Only the connection wiring changes once the SDK
 * surface is verified — the mapping logic below is stable.
 *
 * All period values are converted to MINUTES at this boundary. Timestamps are UTC ms.
 */
import type {
  CreateSprintInput,
  UpdateSprintInput,
  YouTrackClient,
  YtBoard,
  YtCustomField,
  YtIssue,
  YtSprint,
  YtUser,
} from './youtrack-client.js';

export interface RestConnection {
  get(path: string, query?: Record<string, string>): Promise<unknown>;
  post(path: string, body: unknown, query?: Record<string, string>): Promise<unknown>;
}

/**
 * Runtime connection parameters for the in-YouTrack scripting transport. The backend has
 * no `fetch` and (per the app architecture) no automatic same-instance REST auth, so the
 * HTTP handler supplies the instance base URL + an app token (from app settings) before
 * each dispatch. NOTE: the "blessed" long-term approach is the Backend JavaScript
 * (entities) API; this token-authenticated REST-to-self is a pragmatic bridge.
 */
let runtimeBaseUrl = 'http://localhost:8080';
let runtimeToken: string | null = null;
export function configureRuntimeConnection(baseUrl: string | null, token: string | null): void {
  if (baseUrl !== null && baseUrl.length > 0) runtimeBaseUrl = baseUrl;
  runtimeToken = token;
}

/**
 * App-owned extension-property storage. YouTrack's entities API (the only backend path to
 * per-entity extension properties) is keyed by entity-native ids, not the REST ids this
 * client uses everywhere, so instead the whole app state is kept as one JSON map in the
 * app's AppGlobalStorage (`scpStateJson`), keyed by `"<EntityType>:<restId>"`. The HTTP
 * handler loads it into this holder before dispatch and writes it back after (see
 * backend/index.ts), so writes persist. NOTE: single-blob read-modify-write is fine for
 * per-project use but is not concurrency-safe across simultaneous writers — a future move
 * to true per-entity extension properties (entity id-mapping) would remove that caveat.
 */
type EntityProps = Record<string, string | number | boolean | null>;
let runtimeStore: Record<string, EntityProps> = {};
export function setRuntimeStore(store: Record<string, EntityProps> | null): void {
  runtimeStore = store ?? {};
}
export function getRuntimeStore(): Record<string, EntityProps> {
  return runtimeStore;
}
function storeKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

/** yyyy-mm-dd for a UTC-midnight epoch ms (YouTrack sprint dates are day-precision). */
function msToIso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number') return null;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** UTC-midnight epoch ms for a yyyy-mm-dd date. */
function isoToMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** A fetch-based connection for the integration harness / local runs. */
export class FetchRestConnection implements RestConnection {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private url(path: string, query?: Record<string, string>): string {
    const u = new URL(path.replace(/^\//, ''), this.baseUrl.replace(/\/?$/, '/'));
    if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async request(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<unknown> {
    const res = await fetch(this.url(path, query), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`YouTrack REST ${method} ${path} failed with ${res.status}`);
    }
    const text = await res.text();
    return text.length > 0 ? JSON.parse(text) : null;
  }

  get(path: string, query?: Record<string, string>): Promise<unknown> {
    return this.request('GET', path, query);
  }
  post(path: string, body: unknown, query?: Record<string, string>): Promise<unknown> {
    return this.request('POST', path, query, body);
  }
}

/** Build the default connection from environment variables (local/integration use). */
function connectionFromEnv(): RestConnection {
  const baseUrl = process.env.YT_TEST_BASE_URL ?? process.env.YT_BASE_URL ?? '';
  const token = process.env.YT_TEST_ADMIN_TOKEN ?? process.env.YT_TOKEN ?? '';
  return new FetchRestConnection(baseUrl, token);
}

/**
 * Connection used inside a deployed YouTrack app: the runtime has no `fetch`, so REST
 * calls to the same instance go through the workflow API's synchronous
 * {@link http.Connection} (`@jetbrains/youtrack-scripting-api/http`). The base URL and an
 * app token come from app settings (secret) so the app authenticates as itself.
 */
export class ScriptingApiConnection implements RestConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime-provided module
  private readonly http: any;
  constructor() {
    // Required lazily so this file stays importable off-runtime (tests use FetchRest).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.http = require('@jetbrains/youtrack-scripting-api/http');
  }

  private newConn(): {
    getSync(p: string, q: unknown): { isSuccess: boolean; code?: number; status?: number; response?: string };
    postSync(p: string, q: unknown, b?: string): { isSuccess: boolean; code?: number; status?: number; response?: string };
  } {
    // Read the current base URL + token each call (the handler sets them from app settings).
    const c = new this.http.Connection(runtimeBaseUrl);
    c.addHeader('Accept', 'application/json');
    c.addHeader('Content-Type', 'application/json');
    if (runtimeToken !== null && runtimeToken.length > 0) c.bearerAuth(runtimeToken);
    return c as ReturnType<ScriptingApiConnection['newConn']>;
  }

  private static toQuery(query?: Record<string, string>): Array<{ name: string; value: string }> {
    return query ? Object.entries(query).map(([name, value]) => ({ name, value })) : [];
  }

  private static parse(
    res: { isSuccess: boolean; code?: number; status?: number; response?: string },
    method: string,
    path: string,
  ): unknown {
    if (!res.isSuccess) {
      throw new Error(`YouTrack REST ${method} ${path} failed with ${res.code ?? res.status ?? '?'}`);
    }
    const text = res.response ?? '';
    return text.length > 0 ? JSON.parse(text) : null;
  }

  get(path: string, query?: Record<string, string>): Promise<unknown> {
    const res = this.newConn().getSync(path, ScriptingApiConnection.toQuery(query));
    return Promise.resolve(ScriptingApiConnection.parse(res, 'GET', path));
  }

  post(path: string, body: unknown, query?: Record<string, string>): Promise<unknown> {
    const res = this.newConn().postSync(
      path,
      ScriptingApiConnection.toQuery(query),
      JSON.stringify(body),
    );
    return Promise.resolve(ScriptingApiConnection.parse(res, 'POST', path));
  }
}

/**
 * Choose the connection for the current runtime. Inside YouTrack the scripting API's
 * `require` succeeds and we talk to the same instance; off-runtime (unit/integration
 * harness) we fall back to the `fetch`-based connection from env.
 */
function defaultConnection(): RestConnection {
  try {
    return new ScriptingApiConnection();
  } catch {
    return connectionFromEnv();
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw REST JSON is dynamically shaped; access is narrowed locally. */
function pick(obj: unknown, key: string): any {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

export class YouTrackHttpClient implements YouTrackClient {
  constructor(private readonly conn: RestConnection = defaultConnection()) {}

  async getCurrentUser(): Promise<YtUser> {
    const u = await this.conn.get('/api/users/me', { fields: 'id,login,name' });
    return { id: String(pick(u, 'id')), login: String(pick(u, 'login')), name: String(pick(u, 'name')) };
  }

  async getUsers(userIds: readonly string[]): Promise<YtUser[]> {
    const out: YtUser[] = [];
    for (const id of userIds) {
      const u = await this.conn.get(`/api/users/${encodeURIComponent(id)}`, {
        fields: 'id,login,name',
      });
      out.push({ id: String(pick(u, 'id')), login: String(pick(u, 'login')), name: String(pick(u, 'name')) });
    }
    return out;
  }

  async isUserInGroup(userId: string, groupName: string): Promise<boolean> {
    // Verified on 2025.3: /api/groups exposes name + members; per-user /groups 404s.
    const groups = await this.conn.get('/api/groups', {
      fields: 'name,users(id)',
      $top: '500',
    });
    if (!Array.isArray(groups)) return false;
    const group = groups.find((g) => pick(g, 'name') === groupName);
    const users = group ? pick(group, 'users') : null;
    return Array.isArray(users) && users.some((u) => pick(u, 'id') === userId);
  }

  async listBoards(): Promise<YtBoard[]> {
    const boards = await this.conn.get('/api/agiles', {
      fields: 'id,name,sprintsSettings(disableSprints),projects(id)',
    });
    if (!Array.isArray(boards)) return [];
    return boards.map((b) => ({
      id: String(pick(b, 'id')),
      name: String(pick(b, 'name')),
      usesSprints: pick(pick(b, 'sprintsSettings'), 'disableSprints') !== true,
      projectIds: (pick(b, 'projects') ?? []).map((p: unknown) => String(pick(p, 'id'))),
    }));
  }

  async getBoard(boardId: string): Promise<YtBoard | null> {
    const boards = await this.listBoards();
    return boards.find((b) => b.id === boardId) ?? null;
  }

  async canManageBoard(boardId: string): Promise<boolean> {
    // SPIKE: confirm how to resolve the caller's real Board (sprint create/update)
    // permission. Placeholder assumes a readable board grants no write; the real
    // check must query the caller's permissions for the board's project.
    const board = await this.getBoard(boardId);
    return board !== null;
  }

  async getProjectCustomFields(projectId: string): Promise<YtCustomField[]> {
    const fields = await this.conn.get(
      `/api/admin/projects/${encodeURIComponent(projectId)}/customFields`,
      { fields: 'field(name,fieldType(id))' },
    );
    if (!Array.isArray(fields)) return [];
    return fields.map((f) => {
      const field = pick(f, 'field');
      const typeId = String(pick(pick(field, 'fieldType'), 'id') ?? '');
      return {
        name: String(pick(field, 'name')),
        type: typeId.includes('period') ? 'period' : typeId,
        attachedToProject: true,
      };
    });
  }

  async listSprints(boardId: string): Promise<YtSprint[]> {
    const sprints = await this.conn.get(`/api/agiles/${encodeURIComponent(boardId)}/sprints`, {
      fields: 'id,name,goal,start,finish,archived',
    });
    if (!Array.isArray(sprints)) return [];
    return sprints.map(mapSprint);
  }

  async getSprint(boardId: string, sprintId: string): Promise<YtSprint | null> {
    const s = await this.conn.get(
      `/api/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`,
      { fields: 'id,name,goal,start,finish,archived' },
    );
    return s ? mapSprint(s) : null;
  }

  async createSprint(input: CreateSprintInput): Promise<YtSprint> {
    const s = await this.conn.post(
      `/api/agiles/${encodeURIComponent(input.boardId)}/sprints`,
      {
        name: input.name,
        goal: input.goal,
        start: isoToMs(input.start),
        finish: isoToMs(input.finish),
      },
      { fields: 'id,name,goal,start,finish,archived' },
    );
    return mapSprint(s);
  }

  async updateSprint(
    boardId: string,
    sprintId: string,
    patch: UpdateSprintInput,
  ): Promise<YtSprint> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.goal !== undefined) body.goal = patch.goal;
    if (patch.start !== undefined) body.start = isoToMs(patch.start);
    if (patch.finish !== undefined) body.finish = isoToMs(patch.finish);
    const s = await this.conn.post(
      `/api/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`,
      body,
      { fields: 'id,name,goal,start,finish,archived' },
    );
    return mapSprint(s);
  }

  async getSprintIssues(
    boardId: string,
    sprintId: string,
    originalEffortField: string,
    currentEffortField: string,
  ): Promise<YtIssue[]> {
    // SPIKE: confirm the Assignee field name/shape on the target version. Assignee is a
    // single-user custom field; we read its value id as the stable user id.
    const fields =
      'id,resolved,customFields(name,value(minutes,presentation,id,login))';
    const issues = await this.conn.get(
      `/api/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}/issues`,
      { fields },
    );
    if (!Array.isArray(issues)) return [];
    return issues.map((i) => {
      const cf = pick(i, 'customFields');
      const periodMinutes = (name: string): number | null => {
        if (!Array.isArray(cf)) return null;
        const f = cf.find((c) => pick(c, 'name') === name);
        const m = pick(pick(f, 'value'), 'minutes');
        return typeof m === 'number' ? m : null;
      };
      const resolvedMs = pick(i, 'resolved');
      const assigneeId = (): string | null => {
        if (!Array.isArray(cf)) return null;
        const f = cf.find((c) => pick(c, 'name') === 'Assignee');
        const id = pick(pick(f, 'value'), 'id');
        return typeof id === 'string' && id.length > 0 ? id : null;
      };
      return {
        id: String(pick(i, 'id')),
        originalEffortMinutes: periodMinutes(originalEffortField),
        currentEffortMinutes: periodMinutes(currentEffortField),
        resolved: typeof resolvedMs === 'number' && resolvedMs > 0,
        resolvedAt: typeof resolvedMs === 'number' && resolvedMs > 0 ? resolvedMs : null,
        assigneeId: assigneeId(),
      };
    });
  }

  async moveUnresolvedIssues(
    boardId: string,
    fromSprintId: string,
    toSprintId: string,
  ): Promise<void> {
    const issues = await this.getSprintIssues(boardId, fromSprintId, '', '');
    for (const issue of issues) {
      if (issue.resolved) continue;
      // SPIKE: verify the endpoint for adding an issue to a sprint on the target version.
      await this.conn.post(
        `/api/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(toSprintId)}/issues`,
        { id: issue.id },
      );
    }
  }

  async getExtensionProperty(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    key: string,
  ): Promise<string | number | boolean | null> {
    const all = await this.getExtensionProperties(entityType, entityId, [key]);
    return all[key] ?? null;
  }

  async getExtensionProperties(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    keys: readonly string[],
  ): Promise<Record<string, string | number | boolean | null>> {
    const out: Record<string, string | number | boolean | null> = {};
    const ep = runtimeStore[storeKey(entityType, entityId)] ?? {};
    for (const k of keys) {
      const v = ep[k];
      out[k] =
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;
    }
    return out;
  }

  async setExtensionProperty(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    key: string,
    value: string | number | boolean | null,
  ): Promise<void> {
    await this.setExtensionProperties(entityType, entityId, { [key]: value });
  }

  async setExtensionProperties(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    values: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    const key = storeKey(entityType, entityId);
    const ep = (runtimeStore[key] ??= {});
    for (const [k, v] of Object.entries(values)) ep[k] = v;
  }
}

function mapSprint(s: unknown): YtSprint {
  return {
    id: String(pick(s, 'id')),
    name: String(pick(s, 'name') ?? ''),
    goal: String(pick(s, 'goal') ?? ''),
    start: msToIso(pick(s, 'start')),
    finish: msToIso(pick(s, 'finish')),
    archived: pick(s, 'archived') === true,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
