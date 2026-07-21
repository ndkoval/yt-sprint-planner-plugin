/**
 * Native YouTrack data over the CURRENT USER's REST session (`host.fetchYouTrack`).
 * YouTrack enforces the caller's real permissions on every call — the app holds no
 * token and never widens access. All period values are converted to MINUTES at this
 * boundary; sprint dates cross it as epoch-ms and are exposed as yyyy-mm-dd.
 */
import { isoToUtcMs, utcMsToIso } from '../domain/index.js';
import type { HostRequestInit, WidgetHost } from './host.js';

export interface YtUser {
  id: string;
  login: string;
  name: string;
}

export interface YtBoard {
  id: string;
  name: string;
  usesSprints: boolean;
  projectIds: string[];
}

export interface YtSprint {
  id: string;
  name: string;
  goal: string;
  /** yyyy-mm-dd, or null when the sprint has no dates. */
  start: string | null;
  finish: string | null;
  archived: boolean;
}

export interface YtIssue {
  id: string;
  idReadable?: string | undefined;
  summary?: string | undefined;
  originalEffortMinutes: number | null;
  currentEffortMinutes: number | null;
  resolved: boolean;
  resolvedAt: number | null;
  /** Login of the assignee, or null when unassigned. */
  assigneeLogin: string | null;
  assigneeName: string | null;
}

export interface CreateSprintInput {
  boardId: string;
  name: string;
  goal: string;
  start: string;
  finish: string;
}

export interface UpdateSprintInput {
  name?: string | undefined;
  goal?: string | undefined;
  start?: string | undefined;
  finish?: string | undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw REST JSON is dynamically shaped; access is narrowed locally. */
function pick(obj: unknown, key: string): any {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

// Field selector shared by sprint-issue reads and backlog searches. Assignee is a
// SingleUserIssueCustomField whose value exposes login (stable key) and name (display).
const ISSUE_FIELDS =
  'id,idReadable,summary,resolved,customFields(name,value(minutes,presentation,login,name))';

/** Normalise one raw YouTrack issue for the two configured effort fields. */
function mapYtIssue(i: unknown, originalEffortField: string, currentEffortField: string): YtIssue {
  const cf = pick(i, 'customFields');
  const periodMinutes = (name: string): number | null => {
    if (!Array.isArray(cf)) return null;
    const f = cf.find((c) => pick(c, 'name') === name);
    const m = pick(pick(f, 'value'), 'minutes');
    return typeof m === 'number' ? m : null;
  };
  const resolvedMs = pick(i, 'resolved');
  const assigneeField = Array.isArray(cf)
    ? cf.find((c) => pick(c, 'name') === 'Assignee')
    : undefined;
  const assigneeValue = pick(assigneeField, 'value');
  const login = pick(assigneeValue, 'login');
  const assigneeLogin = typeof login === 'string' && login.length > 0 ? login : null;
  const aname = pick(assigneeValue, 'name');
  const idReadable = pick(i, 'idReadable');
  const summary = pick(i, 'summary');
  return {
    id: String(pick(i, 'id')),
    idReadable: typeof idReadable === 'string' ? idReadable : undefined,
    summary: typeof summary === 'string' ? summary : undefined,
    originalEffortMinutes: periodMinutes(originalEffortField),
    currentEffortMinutes: periodMinutes(currentEffortField),
    resolved: typeof resolvedMs === 'number' && resolvedMs > 0,
    resolvedAt: typeof resolvedMs === 'number' && resolvedMs > 0 ? resolvedMs : null,
    assigneeLogin,
    assigneeName: assigneeLogin !== null && typeof aname === 'string' ? aname : null,
  };
}

function mapSprint(s: unknown): YtSprint {
  const start = pick(s, 'start');
  const finish = pick(s, 'finish');
  return {
    id: String(pick(s, 'id')),
    name: String(pick(s, 'name') ?? ''),
    goal: String(pick(s, 'goal') ?? ''),
    start: typeof start === 'number' ? utcMsToIso(start) : null,
    finish: typeof finish === 'number' ? utcMsToIso(finish) : null,
    archived: pick(s, 'archived') === true,
  };
}

/** Append query parameters to a /api-relative path. */
function withQuery(path: string, query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
}

export class NativeYouTrack {
  constructor(private readonly host: WidgetHost) {}

  private get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    return this.host.fetchYouTrack(withQuery(path, query));
  }

  private post(path: string, body: unknown, query: Record<string, string> = {}): Promise<unknown> {
    const init: HostRequestInit = { method: 'POST', body: JSON.stringify(body) };
    return this.host.fetchYouTrack(withQuery(path, query), init);
  }

  private delete(path: string): Promise<unknown> {
    return this.host.fetchYouTrack(path, { method: 'DELETE' });
  }

  /** Project key (shortName) + name for a project REST id. */
  async getProject(projectId: string): Promise<{ id: string; key: string; name: string }> {
    const p = await this.get(`admin/projects/${encodeURIComponent(projectId)}`, {
      fields: 'id,shortName,name',
    });
    return { id: String(pick(p, 'id')), key: String(pick(p, 'shortName')), name: String(pick(p, 'name') ?? '') };
  }

  async searchUsers(query: string, limit = 20): Promise<YtUser[]> {
    const users = await this.get('users', {
      fields: 'id,login,name',
      ...(query.trim().length > 0 ? { query } : {}),
      $top: String(limit),
    });
    if (!Array.isArray(users)) return [];
    return users
      .filter((u) => typeof pick(u, 'login') === 'string')
      .map((u) => ({
        id: String(pick(u, 'id')),
        login: String(pick(u, 'login')),
        name: String(pick(u, 'name') ?? pick(u, 'login')),
      }));
  }

  async listBoards(): Promise<YtBoard[]> {
    const boards = await this.get('agiles', {
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

  async getProjectCustomFields(projectId: string): Promise<Array<{ name: string; type: string }>> {
    const fields = await this.get(`admin/projects/${encodeURIComponent(projectId)}/customFields`, {
      fields: 'field(name,fieldType(id))',
    });
    if (!Array.isArray(fields)) return [];
    return fields.map((f) => {
      const field = pick(f, 'field');
      const typeId = String(pick(pick(field, 'fieldType'), 'id') ?? '');
      return { name: String(pick(field, 'name')), type: typeId.includes('period') ? 'period' : typeId };
    });
  }

  async listSprints(boardId: string): Promise<YtSprint[]> {
    const sprints = await this.get(`agiles/${encodeURIComponent(boardId)}/sprints`, {
      fields: 'id,name,goal,start,finish,archived',
      $top: '200',
    });
    if (!Array.isArray(sprints)) return [];
    return sprints.map(mapSprint);
  }

  async getSprint(boardId: string, sprintId: string): Promise<YtSprint | null> {
    const s = await this.get(
      `agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`,
      { fields: 'id,name,goal,start,finish,archived' },
    );
    return s ? mapSprint(s) : null;
  }

  async createSprint(input: CreateSprintInput): Promise<YtSprint> {
    const s = await this.post(
      `agiles/${encodeURIComponent(input.boardId)}/sprints`,
      {
        name: input.name,
        goal: input.goal,
        start: isoToUtcMs(input.start),
        finish: isoToUtcMs(input.finish),
      },
      { fields: 'id,name,goal,start,finish,archived' },
    );
    return mapSprint(s);
  }

  async updateSprint(boardId: string, sprintId: string, patch: UpdateSprintInput): Promise<YtSprint> {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.goal !== undefined) body.goal = patch.goal;
    if (patch.start !== undefined) body.start = isoToUtcMs(patch.start);
    if (patch.finish !== undefined) body.finish = isoToUtcMs(patch.finish);
    const s = await this.post(
      `agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}`,
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
    const issues = await this.get(
      `agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}/issues`,
      { fields: ISSUE_FIELDS, $top: '1000' },
    );
    if (!Array.isArray(issues)) return [];
    return issues.map((i) => mapYtIssue(i, originalEffortField, currentEffortField));
  }

  async searchIssues(
    query: string,
    originalEffortField: string,
    currentEffortField: string,
    limit = 200,
  ): Promise<YtIssue[]> {
    if (query.trim().length === 0) return [];
    const issues = await this.get('issues', {
      fields: ISSUE_FIELDS,
      query,
      $top: String(limit),
    });
    if (!Array.isArray(issues)) return [];
    return issues.map((i) => mapYtIssue(i, originalEffortField, currentEffortField));
  }

  async addIssueToSprint(boardId: string, sprintId: string, issueId: string): Promise<void> {
    await this.post(
      `agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}/issues`,
      { id: issueId },
    );
  }

  async removeIssueFromSprint(boardId: string, sprintId: string, issueId: string): Promise<void> {
    await this.delete(
      `agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId)}/issues/${encodeURIComponent(issueId)}`,
    );
  }

  async moveUnresolvedIssues(boardId: string, fromSprintId: string, toSprintId: string): Promise<void> {
    const issues = await this.getSprintIssues(boardId, fromSprintId, '', '');
    for (const issue of issues) {
      if (issue.resolved) continue;
      await this.addIssueToSprint(boardId, toSprintId, issue.id);
    }
  }

  /** Assign by login; null unassigns. Runs as the current user (permissions enforced). */
  async setIssueAssignee(issueId: string, assigneeLogin: string | null): Promise<void> {
    await this.post(
      `issues/${encodeURIComponent(issueId)}`,
      {
        customFields: [
          {
            name: 'Assignee',
            $type: 'SingleUserIssueCustomField',
            value: assigneeLogin !== null ? { login: assigneeLogin } : null,
          },
        ],
      },
      { fields: 'id' },
    );
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
