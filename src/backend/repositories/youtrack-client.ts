/**
 * Transport boundary to YouTrack. This interface is the ONLY place the backend
 * talks to YouTrack; contract tests (§24) mock exactly this interface, and the real
 * implementation ({@link ./youtrack-http-client.ts}) speaks REST/HTTP.
 *
 * Effort/period values crossing this boundary are in MINUTES (YouTrack period fields
 * store minutes). Timestamps are UTC epoch ms. Dates are yyyy-mm-dd.
 */

export interface YtUser {
  id: string;
  login: string;
  name: string;
}

export interface YtBoard {
  id: string;
  name: string;
  /** Whether the board is sprint-based (has an sprints/columnSettings sprint field). */
  usesSprints: boolean;
  /** Project ids associated with the board. */
  projectIds: string[];
}

export interface YtSprint {
  id: string;
  name: string;
  goal: string;
  /** yyyy-mm-dd or null if unset. */
  start: string | null;
  /** yyyy-mm-dd or null if unset. */
  finish: string | null;
  archived: boolean;
}

export interface YtIssue {
  id: string;
  /** Human-readable id, e.g. "AGP-42" (may be absent on older shapes). */
  idReadable?: string | undefined;
  /** Issue summary/title (may be absent when not requested). */
  summary?: string | undefined;
  /** Value of the configured Original Effort period field, in minutes, or null. */
  originalEffortMinutes: number | null;
  /** Value of the configured Current Effort period field, in minutes, or null. */
  currentEffortMinutes: number | null;
  resolved: boolean;
  /** UTC ms the issue was resolved, or null. */
  resolvedAt: number | null;
  /** Stable user id of the assignee, or null/absent when the task is unassigned. */
  assigneeId?: string | null | undefined;
  /** Display name of the assignee, or null/absent when unassigned. */
  assigneeName?: string | null | undefined;
}

export interface YtCustomField {
  name: string;
  /** YouTrack field type, e.g. "period". */
  type: string;
  /** Whether the field is attached to the project. */
  attachedToProject: boolean;
}

/** A native-Sprint create request (name/start/finish are set via REST — §3.1). */
export interface CreateSprintInput {
  boardId: string;
  name: string;
  goal: string;
  start: string;
  finish: string;
}

/** Patch of native Sprint fields. Optionals accept `undefined` to match parsed input. */
export interface UpdateSprintInput {
  name?: string | undefined;
  goal?: string | undefined;
  start?: string | undefined;
  finish?: string | undefined;
}

/**
 * The transport boundary. All methods are async. Implementations must translate
 * YouTrack's raw shapes into these normalised types and back.
 */
export interface YouTrackClient {
  /** The authenticated caller. */
  getCurrentUser(): Promise<YtUser>;
  /** Resolve users by id (for capacity-row snapshots). */
  getUsers(userIds: readonly string[]): Promise<YtUser[]>;
  /** Search users by login/name/email prefix (for participant/assignee pickers). */
  searchUsers(query: string, limit?: number): Promise<YtUser[]>;
  /** Whether the caller belongs to the named group (manager check). */
  isUserInGroup(userId: string, groupName: string): Promise<boolean>;

  /** Boards visible to the caller. */
  listBoards(): Promise<YtBoard[]>;
  getBoard(boardId: string): Promise<YtBoard | null>;
  /** Whether the caller can create/modify sprints on the board (real Board permission). */
  canManageBoard(boardId: string): Promise<boolean>;

  /** Custom fields attached to a project (for effort-field validation). */
  getProjectCustomFields(projectId: string): Promise<YtCustomField[]>;

  /** All sprints on a board. */
  listSprints(boardId: string): Promise<YtSprint[]>;
  getSprint(boardId: string, sprintId: string): Promise<YtSprint | null>;
  createSprint(input: CreateSprintInput): Promise<YtSprint>;
  updateSprint(boardId: string, sprintId: string, patch: UpdateSprintInput): Promise<YtSprint>;

  /**
   * Issues currently in the sprint, with the two configured effort field values
   * resolved to minutes and resolution state/timestamp.
   */
  getSprintIssues(
    boardId: string,
    sprintId: string,
    originalEffortField: string,
    currentEffortField: string,
  ): Promise<YtIssue[]>;

  /** Move unresolved issues from one sprint to another (create-next option). */
  moveUnresolvedIssues(boardId: string, fromSprintId: string, toSprintId: string): Promise<void>;

  /**
   * Issues matching a YouTrack search query (the configured backlog search). The two
   * configured effort fields are resolved to minutes. Callers subtract the ones already in
   * the Sprint to produce the backlog.
   */
  searchIssues(
    query: string,
    originalEffortField: string,
    currentEffortField: string,
    limit?: number,
  ): Promise<YtIssue[]>;

  /** Add an issue to a Sprint (pull from backlog into the Sprint). Idempotent. */
  addIssueToSprint(boardId: string, sprintId: string, issueId: string): Promise<void>;
  /** Remove an issue from a Sprint (send back to the backlog). Idempotent. */
  removeIssueFromSprint(boardId: string, sprintId: string, issueId: string): Promise<void>;

  /**
   * Set (or clear) an issue's Assignee. `assigneeId` null unassigns. Requires the app's
   * Issue.Update scope; the caller's manager permission is enforced server-side first.
   */
  setIssueAssignee(issueId: string, assigneeId: string | null): Promise<void>;

  /** Read an app extension property from an entity. Returns null if unset. */
  getExtensionProperty(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    key: string,
  ): Promise<string | number | boolean | null>;

  /** Write an app extension property on an entity. */
  setExtensionProperty(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    key: string,
    value: string | number | boolean | null,
  ): Promise<void>;

  /** Batch-read several extension properties on one entity. */
  getExtensionProperties(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    keys: readonly string[],
  ): Promise<Record<string, string | number | boolean | null>>;

  /** Batch-write several extension properties on one entity (atomic per entity). */
  setExtensionProperties(
    entityType: 'Sprint' | 'Issue' | 'Project',
    entityId: string,
    values: Record<string, string | number | boolean | null>,
  ): Promise<void>;
}
