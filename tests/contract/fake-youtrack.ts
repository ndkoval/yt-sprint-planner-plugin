/**
 * In-memory fake implementing the {@link YouTrackClient} transport boundary for
 * contract tests (§24). This is the ONLY thing mocked; every backend service runs
 * for real against this fake. Extension properties round-trip through a per-entity
 * store so reconciliation and capacity persistence are observable.
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
} from '../../src/backend/repositories/youtrack-client.js';
import type { CapacityDocument, ProjectConfig } from '../../src/shared/types.js';

type EntityType = 'Sprint' | 'Issue' | 'Project';
type ExtValue = string | number | boolean | null;
type ExtRecord = Record<string, ExtValue>;

/** A single named fault the fake should raise the next time a method is called. */
export type FaultMethod =
  | 'getCurrentUser'
  | 'listBoards'
  | 'listSprints'
  | 'getSprintIssues'
  | 'searchUsers'
  | 'setIssueAssignee'
  | 'setIssueEffort'
  | 'getExtensionProperties';

export interface SeedSprintOptions {
  boardId: string;
  sprint: YtSprint;
  projectId: string;
  sequence: number;
  focusFactor: number;
  focusFactorSource?: string;
  capacity?: CapacityDocument | null;
  issues?: YtIssue[];
  /** Extra extension properties (e.g. deliberately corrupted metric caches). */
  extra?: ExtRecord;
}

export interface SeedProjectOptions {
  projectId: string;
  config: ProjectConfig;
  revision?: number;
  managersGroup?: string;
  /** Store the raw JSON verbatim (e.g. a malformed string) instead of stringifying config. */
  rawConfigJson?: string;
}

let sprintCounter = 0;

export class FakeYouTrack implements YouTrackClient {
  currentUserId = '1-10';

  readonly faults = new Set<FaultMethod>();

  private readonly users = new Map<string, YtUser>();
  private readonly boards = new Map<string, YtBoard>();
  private readonly sprintsByBoard = new Map<string, YtSprint[]>();
  private readonly issuesBySprint = new Map<string, YtIssue[]>();
  private backlog: YtIssue[] = [];
  private readonly groups = new Map<string, Set<string>>();
  private readonly boardManagers = new Map<string, Set<string>>();
  private readonly projectFields = new Map<string, YtCustomField[]>();
  private readonly ext = new Map<string, ExtRecord>();
  // Configured effort field names, captured at seed time so setIssueEffort can map a field name
  // back to the original/current effort bucket (the fake stores effort by bucket, not by name).
  private originalEffortFieldName = '';
  private currentEffortFieldName = '';

  // ---- seeding helpers -------------------------------------------------------

  seedUser(user: YtUser): this {
    this.users.set(user.id, user);
    return this;
  }

  seedBoard(board: YtBoard): this {
    this.boards.set(board.id, board);
    if (!this.sprintsByBoard.has(board.id)) this.sprintsByBoard.set(board.id, []);
    return this;
  }

  addGroupMember(group: string, userId: string): this {
    const set = this.groups.get(group) ?? new Set<string>();
    set.add(userId);
    this.groups.set(group, set);
    return this;
  }

  grantBoardPermission(boardId: string, userId: string): this {
    const set = this.boardManagers.get(boardId) ?? new Set<string>();
    set.add(userId);
    this.boardManagers.set(boardId, set);
    return this;
  }

  setProjectFields(projectId: string, fields: YtCustomField[]): this {
    this.projectFields.set(projectId, fields);
    return this;
  }

  seedSprint(boardId: string, sprint: YtSprint): this {
    const list = this.sprintsByBoard.get(boardId) ?? [];
    list.push(sprint);
    this.sprintsByBoard.set(boardId, list);
    return this;
  }

  seedIssues(boardId: string, sprintId: string, issues: YtIssue[]): this {
    this.issuesBySprint.set(`${boardId}:${sprintId}`, issues);
    return this;
  }

  /** Direct read of the persisted extension-property store (test assertions). */
  peekExtension(entityType: EntityType, entityId: string, key: string): ExtValue | undefined {
    return this.ext.get(`${entityType}:${entityId}`)?.[key];
  }

  /** Directly overwrite a persisted extension property (e.g. to corrupt a cache). */
  pokeExtension(entityType: EntityType, entityId: string, key: string, value: ExtValue): this {
    const store = this.ext.get(`${entityType}:${entityId}`) ?? {};
    store[key] = value;
    this.ext.set(`${entityType}:${entityId}`, store);
    return this;
  }

  /** Seed a configured project: writes scpConfigJson/revision and the managers group. */
  seedConfiguredProject(opts: SeedProjectOptions): this {
    const revision = opts.revision ?? 1;
    this.originalEffortFieldName = opts.config.originalEffortField;
    this.currentEffortFieldName = opts.config.currentEffortField;
    const store: ExtRecord = {
      scpConfigJson: opts.rawConfigJson ?? JSON.stringify(opts.config),
      scpConfigRevision: revision,
    };
    if (opts.managersGroup) store.scpCapacityManagers = opts.managersGroup;
    this.ext.set(`Project:${opts.projectId}`, {
      ...(this.ext.get(`Project:${opts.projectId}`) ?? {}),
      ...store,
    });
    return this;
  }

  /** Seed a managed sprint: native sprint + scpManaged=true + capacity + metrics. */
  seedManagedSprint(opts: SeedSprintOptions): this {
    this.seedSprint(opts.boardId, opts.sprint);
    if (opts.issues) this.seedIssues(opts.boardId, opts.sprint.id, opts.issues);
    const store: ExtRecord = {
      scpManaged: true,
      scpSchemaVersion: 1,
      scpProjectId: opts.projectId,
      scpBoardId: opts.boardId,
      scpSequence: opts.sequence,
      scpFocusFactor: opts.focusFactor,
      scpFocusFactorSource: opts.focusFactorSource ?? 'bootstrap',
      scpMetricsDirty: false,
      scpDataIntegrityStatus: 'up-to-date',
      scpExcludedFromCalibration: false,
    };
    if (opts.capacity) {
      store.scpCapacityJson = JSON.stringify(opts.capacity);
      store.scpCapacityRevision = 1;
    }
    this.ext.set(`Sprint:${opts.sprint.id}`, { ...store, ...(opts.extra ?? {}) });
    return this;
  }

  // ---- YouTrackClient implementation ----------------------------------------

  private maybeThrow(method: FaultMethod): void {
    if (this.faults.has(method)) {
      throw new Error(`simulated transport failure in ${method}`);
    }
  }

  getCurrentUser(): Promise<YtUser> {
    this.maybeThrow('getCurrentUser');
    const user = this.users.get(this.currentUserId);
    if (!user) throw new Error(`no seeded user ${this.currentUserId}`);
    return Promise.resolve(user);
  }

  getUsers(userIds: readonly string[]): Promise<YtUser[]> {
    const result: YtUser[] = [];
    for (const id of userIds) {
      const user = this.users.get(id);
      if (user) result.push(user);
    }
    return Promise.resolve(result);
  }

  searchUsers(query: string, limit = 20): Promise<YtUser[]> {
    this.maybeThrow('searchUsers');
    const q = query.trim().toLowerCase();
    const all = [...this.users.values()];
    const matched =
      q.length === 0
        ? all
        : all.filter(
            (u) => u.login.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
          );
    return Promise.resolve(matched.slice(0, limit));
  }

  isUserInGroup(userId: string, groupName: string): Promise<boolean> {
    return Promise.resolve(this.groups.get(groupName)?.has(userId) ?? false);
  }

  listBoards(): Promise<YtBoard[]> {
    this.maybeThrow('listBoards');
    return Promise.resolve([...this.boards.values()]);
  }

  getBoard(boardId: string): Promise<YtBoard | null> {
    return Promise.resolve(this.boards.get(boardId) ?? null);
  }

  canManageBoard(boardId: string): Promise<boolean> {
    return Promise.resolve(this.boardManagers.get(boardId)?.has(this.currentUserId) ?? false);
  }

  getProjectCustomFields(projectId: string): Promise<YtCustomField[]> {
    return Promise.resolve(this.projectFields.get(projectId) ?? []);
  }

  listSprints(boardId: string): Promise<YtSprint[]> {
    this.maybeThrow('listSprints');
    return Promise.resolve([...(this.sprintsByBoard.get(boardId) ?? [])]);
  }

  getSprint(boardId: string, sprintId: string): Promise<YtSprint | null> {
    const found = (this.sprintsByBoard.get(boardId) ?? []).find((s) => s.id === sprintId);
    return Promise.resolve(found ?? null);
  }

  createSprint(input: CreateSprintInput): Promise<YtSprint> {
    sprintCounter += 1;
    const sprint: YtSprint = {
      id: `sprint-new-${sprintCounter}`,
      name: input.name,
      goal: input.goal,
      start: input.start,
      finish: input.finish,
      archived: false,
    };
    this.seedSprint(input.boardId, sprint);
    return Promise.resolve(sprint);
  }

  updateSprint(boardId: string, sprintId: string, patch: UpdateSprintInput): Promise<YtSprint> {
    const list = this.sprintsByBoard.get(boardId) ?? [];
    const sprint = list.find((s) => s.id === sprintId);
    if (!sprint) throw new Error(`no sprint ${sprintId} on board ${boardId}`);
    if (patch.name !== undefined) sprint.name = patch.name;
    if (patch.goal !== undefined) sprint.goal = patch.goal;
    if (patch.start !== undefined) sprint.start = patch.start;
    if (patch.finish !== undefined) sprint.finish = patch.finish;
    return Promise.resolve(sprint);
  }

  getSprintIssues(
    boardId: string,
    sprintId: string,
    _originalEffortField: string,
    _currentEffortField: string,
  ): Promise<YtIssue[]> {
    this.maybeThrow('getSprintIssues');
    return Promise.resolve([...(this.issuesBySprint.get(`${boardId}:${sprintId}`) ?? [])]);
  }

  moveUnresolvedIssues(boardId: string, fromSprintId: string, toSprintId: string): Promise<void> {
    const fromKey = `${boardId}:${fromSprintId}`;
    const from = this.issuesBySprint.get(fromKey) ?? [];
    const moving = from.filter((i) => !i.resolved);
    const remaining = from.filter((i) => i.resolved);
    this.issuesBySprint.set(fromKey, remaining);
    const toKey = `${boardId}:${toSprintId}`;
    this.issuesBySprint.set(toKey, [...(this.issuesBySprint.get(toKey) ?? []), ...moving]);
    return Promise.resolve();
  }

  setIssueAssignee(issueId: string, assigneeId: string | null): Promise<void> {
    this.maybeThrow('setIssueAssignee');
    // Find the issue in any sprint bucket (or the backlog) and update its assignee.
    for (const issues of [...this.issuesBySprint.values(), this.backlog]) {
      const issue = issues.find((i) => i.id === issueId);
      if (issue) {
        issue.assigneeId = assigneeId;
        issue.assigneeName = assigneeId !== null ? this.users.get(assigneeId)?.name ?? null : null;
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  setIssueEffort(issueId: string, fieldName: string, minutes: number | null): Promise<void> {
    this.maybeThrow('setIssueEffort');
    for (const issues of [...this.issuesBySprint.values(), this.backlog]) {
      const issue = issues.find((i) => i.id === issueId);
      if (issue) {
        if (fieldName === this.originalEffortFieldName) issue.originalEffortMinutes = minutes;
        else if (fieldName === this.currentEffortFieldName) issue.currentEffortMinutes = minutes;
        return Promise.resolve();
      }
    }
    return Promise.resolve();
  }

  /** Seed the backlog pool (issues searchable via {@link searchIssues}). */
  seedBacklog(issues: YtIssue[]): this {
    this.backlog = [...issues];
    return this;
  }

  searchIssues(_query: string, _orig: string, _cur: string, limit = 200): Promise<YtIssue[]> {
    // The fake ignores the query text and returns the seeded backlog pool.
    return Promise.resolve(this.backlog.slice(0, limit));
  }

  addIssueToSprint(boardId: string, sprintId: string, issueId: string): Promise<void> {
    const key = `${boardId}:${sprintId}`;
    const idx = this.backlog.findIndex((i) => i.id === issueId);
    const issue = idx >= 0 ? this.backlog.splice(idx, 1)[0]! : { id: issueId, originalEffortMinutes: null, currentEffortMinutes: null, resolved: false, resolvedAt: null };
    const list = this.issuesBySprint.get(key) ?? [];
    if (!list.some((i) => i.id === issueId)) list.push(issue);
    this.issuesBySprint.set(key, list);
    return Promise.resolve();
  }

  removeIssueFromSprint(boardId: string, sprintId: string, issueId: string): Promise<void> {
    const key = `${boardId}:${sprintId}`;
    const list = this.issuesBySprint.get(key) ?? [];
    const idx = list.findIndex((i) => i.id === issueId);
    if (idx >= 0) {
      const [issue] = list.splice(idx, 1);
      this.issuesBySprint.set(key, list);
      if (issue) this.backlog.push(issue);
    }
    return Promise.resolve();
  }

  getExtensionProperty(entityType: EntityType, entityId: string, key: string): Promise<ExtValue> {
    const store = this.ext.get(`${entityType}:${entityId}`);
    const value = store ? store[key] : undefined;
    return Promise.resolve(value ?? null);
  }

  setExtensionProperty(
    entityType: EntityType,
    entityId: string,
    key: string,
    value: ExtValue,
  ): Promise<void> {
    const mapKey = `${entityType}:${entityId}`;
    const store = this.ext.get(mapKey) ?? {};
    store[key] = value;
    this.ext.set(mapKey, store);
    return Promise.resolve();
  }

  getExtensionProperties(
    entityType: EntityType,
    entityId: string,
    keys: readonly string[],
  ): Promise<ExtRecord> {
    this.maybeThrow('getExtensionProperties');
    const store = this.ext.get(`${entityType}:${entityId}`) ?? {};
    const out: ExtRecord = {};
    for (const key of keys) {
      if (key in store) {
        const v = store[key];
        if (v !== undefined) out[key] = v;
      }
    }
    return Promise.resolve(out);
  }

  setExtensionProperties(
    entityType: EntityType,
    entityId: string,
    values: ExtRecord,
  ): Promise<void> {
    const mapKey = `${entityType}:${entityId}`;
    const store = this.ext.get(mapKey) ?? {};
    for (const [key, value] of Object.entries(values)) store[key] = value;
    this.ext.set(mapKey, store);
    return Promise.resolve();
  }
}
