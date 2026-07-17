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

/* eslint-disable @typescript-eslint/no-explicit-any -- raw REST JSON is dynamically shaped; access is narrowed locally. */
function pick(obj: unknown, key: string): any {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

export class YouTrackHttpClient implements YouTrackClient {
  constructor(private readonly conn: RestConnection = connectionFromEnv()) {}

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
    // SPIKE: verify the correct endpoint for group membership on the target version.
    const groups = await this.conn.get(`/api/users/${encodeURIComponent(userId)}/groups`, {
      fields: 'name',
    });
    return Array.isArray(groups) && groups.some((g) => pick(g, 'name') === groupName);
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
    // SPIKE: app extension properties are read through the app's entity-extensions
    // storage. The REST path/field selector is SDK-specific; confirm on a real
    // instance. Returns nulls until wired.
    void entityType;
    void entityId;
    const out: Record<string, string | number | boolean | null> = {};
    for (const k of keys) out[k] = null;
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
    // SPIKE: writing app extension properties is SDK-specific; confirm the path.
    void entityType;
    void entityId;
    void values;
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
