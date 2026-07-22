/**
 * Contracts shared by the backend HTTP handler and the widgets.
 *
 * The split of responsibilities:
 *  - Native YouTrack data (boards, sprints, issues, users, fields) is read and written
 *    by the widget through `host.fetchYouTrack` in the CURRENT USER's context, so
 *    YouTrack enforces the caller's real permissions.
 *  - App-owned state (config, capacity, focus factor, calibration) lives in project
 *    extension properties and is served by the app backend (`host.fetchApp`), which
 *    authorizes every mutation server-side via `ctx.currentUser`.
 *
 * Backend responses always travel in a 200 envelope ({@link BackendEnvelope}) because
 * the host's `fetchApp` transport does not surface HTTP error bodies reliably
 * (verified on YouTrack 2025.3).
 */
import type {
  CapacityDocument,
  CompletionCalculation,
  FocusFactorOverride,
  FocusFactorSource,
  ProjectConfig,
  TeamSprint,
  TeamSprints,
} from './types.js';

/** Structured error envelope for every failed backend request. */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details: Record<string, unknown>;
  correlationId: string;
}

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_CONFIGURED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CAPACITY_REVISION_CONFLICT'
  | 'CONFIG_REVISION_CONFLICT'
  | 'SPRINT_ALREADY_EXISTS'
  | 'INTERNAL_ERROR';

/** Transport envelope for every backend response. */
export type BackendEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * The team's slice of its Sprint: stored planning state plus metrics computed
 * live over the issues ATTRIBUTED to the team (assignee is a team member).
 * Unassigned issues belong to no member and only appear in the Sprint totals.
 */
export interface TeamSprintView {
  teamId: string;
  teamName: string;

  capacityRevision: number;
  capacity: CapacityDocument;

  focusFactor: number;
  focusFactorSource: FocusFactorSource;
  focusFactorOverride: FocusFactorOverride | null;
  excludedFromCalibration: boolean;
  calibrationSkipReason: string | null;

  rawCapacityMinutes: number;
  plannedCapacityMinutes: number;

  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  observedFocusFactor: number | null;

  /** Per-assignee effort (keyed by member login) for per-person planning load. */
  assignedEffort: Record<string, AssigneeEffortView>;
  /** Unresolved team-attributed issues currently in the Sprint. */
  unresolvedIssueCount: number;
}

/**
 * A native Sprint on the TEAM's board plus the team's stored state and
 * live-computed metrics. Since config v4 every Sprint view belongs to exactly one
 * team (teams plan on their own boards with their own cadences); `team` carries the
 * team-attributed slice, while the sprint-level fields aggregate ALL issues in the
 * native Sprint (including unassigned and outside-team assignees).
 */
export interface SprintView {
  id: string;
  name: string;
  goal: string;
  /** yyyy-mm-dd. */
  start: string;
  /** yyyy-mm-dd. */
  finish: string;
  archived: boolean;
  managed: boolean;
  sequence: number;

  /** The owning team's view (an empty view when the Sprint is not yet managed). */
  team: TeamSprintView;

  /** The team's raw capacity (same as team.rawCapacityMinutes). */
  rawCapacityMinutes: number;
  /** The team's planned capacity. */
  plannedCapacityMinutes: number;

  /** Effort over ALL Sprint issues (team, unassigned and outside assignees). */
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  /** completed (all issues) / raw (team capacity); null when raw is 0. */
  observedFocusFactor: number | null;

  /** UTC ms when these metrics were computed (metrics are always computed live). */
  computedAt: number;

  /** Live completion figures once the Sprint's finish day has passed, else null. */
  completion: CompletionCalculation | null;
  /** Ids of Sprint issues with no Original Effort (UI warning list). */
  issuesMissingOriginalEffort: string[];

  /** Effort on issues left unassigned (they belong to no team). */
  unassignedEffort: AssigneeEffortView;
  /** Unresolved issues currently in the Sprint (how many would carry over). */
  unresolvedIssueCount: number;
}

/** Effort attributed to one assignee (or the unassigned bucket), in minutes. */
export interface AssigneeEffortView {
  originalEffortMinutes: number;
  currentEffortMinutes: number;
}

export interface BoardSummary {
  id: string;
  name: string;
  usesSprints: boolean;
}

/** A YouTrack user, for pickers (participant selection, assignee dropdowns). */
export interface UserSummary {
  /** REST database id (used for native REST writes when available). */
  id: string;
  login: string;
  name: string;
}

/** A project custom field, for the effort-field pickers in settings. */
export interface ProjectFieldSummary {
  name: string;
  /** YouTrack field type, e.g. "period", "integer". */
  type: string;
}

/** One Sprint issue as shown in the planner's "plan work" table. */
export interface IssueView {
  id: string;
  /** Human-readable id, e.g. "AGP-42" (falls back to the internal id if absent). */
  idReadable: string;
  summary: string;
  /** Login of the current assignee, or null when unassigned. */
  assigneeId: string | null;
  /** Display name of the current assignee, or null when unassigned. */
  assigneeName: string | null;
  originalEffortMinutes: number | null;
  currentEffortMinutes: number | null;
  resolved: boolean;
}

export interface SprintSummary {
  id: string;
  name: string;
  start: string;
  finish: string;
  archived: boolean;
  managed: boolean;
  /** App sequence number for managed Sprints; 0 for unmanaged. */
  sequence: number;
  /**
   * Unresolved issues in the Sprint (for the carry-over preview). Computed live for
   * the latest managed Sprint only; 0 elsewhere.
   */
  unresolvedIssueCount: number;
}

// ---------------------------------------------------------------------------
// Backend endpoint contracts. All endpoints take a `project` query parameter
// carrying the project KEY (shortName); mutations are POST with a JSON body.
// ---------------------------------------------------------------------------

/** GET config */
export interface ConfigResponse {
  configured: boolean;
  configRevision: number;
  config: ProjectConfig | null;
  /** True when the caller belongs to the configured Capacity Managers group. */
  isManager: boolean;
  /** True when the caller is the project leader (may bootstrap the first config). */
  isProjectLeader: boolean;
  /** The authenticated caller, resolved server-side. */
  me: { login: string; name: string };
}

/** POST config */
export interface PutConfigRequest {
  expectedRevision: number;
  config: ProjectConfig;
}

/** GET sprint-data — one TEAM's managed-Sprint state (`team` query parameter). */
export interface SprintDataResponse {
  sprints: Record<string, TeamSprint>;
}

/**
 * POST sprint-register — upsert one TEAM's app state for a native Sprint on the
 * team's board. Called after the widget creates a Sprint (seeds sequence + capacity)
 * and after date/name edits (refreshes snapshots; non-customized capacity rows track
 * the new default). The optional `seed` carries a client-computed Focus Factor for a
 * NEW entry (bootstrap otherwise).
 */
export interface RegisterSprintRequest {
  teamId?: string | undefined;
  sprint: { id: string; name: string; start: string; finish: string };
  /** Focus Factor seed for a NEW entry. */
  seed?: { focusFactor: number; focusFactorSource: FocusFactorSource } | undefined;
}

/**
 * `teamId` on the team-scoped mutations is optional: omitted, it resolves to the
 * config's ONLY team (single-team projects and older scripts keep working) and is a
 * validation error when the project has several teams.
 */

/** POST capacity */
export interface CapacityWriteRequest {
  sprintId: string;
  teamId?: string | undefined;
  /** 'me' resolves to the caller server-side; a login targets another row (manager-only). */
  target: 'me' | { userId: string };
  expectedRevision: number;
  availableMinutes?: number | undefined;
  note?: string | undefined;
}

/** POST capacity-reset */
export interface CapacityResetRequest {
  sprintId: string;
  teamId?: string | undefined;
  userId: string;
  expectedRevision: number;
}

/** POST focus-factor */
export interface OverrideFocusFactorRequest {
  sprintId: string;
  teamId?: string | undefined;
  reason: string;
  newValue: number;
}

/** POST calibration */
export interface SetCalibrationRequest {
  sprintId: string;
  teamId?: string | undefined;
  excluded: boolean;
  /** Required when excluding. */
  reason?: string | undefined;
}

/** GET export */
export interface ExportBundle {
  exportedAt: number;
  configRevision: number;
  config: ProjectConfig | null;
  /** Every team's managed Sprints, keyed by team id (v4 era). */
  teams: Record<string, TeamSprints>;
}

/**
 * POST import. The bundle's documents are accepted at ANY supported schema era —
 * v4 bundles carry `teams`, older exports carry `sprints` (v3 entries hold a
 * `teams` map, v2 entries are flat) — everything is migrated on the way in, so
 * export-before-upgrade backups stay restorable.
 */
export interface ImportRequest {
  bundle: {
    exportedAt: number;
    configRevision: number;
    config?: unknown;
    sprints?: unknown;
    teams?: unknown;
  };
  dryRun: boolean;
}
export interface ImportResult {
  applied: boolean;
  sprintCount: number;
  configured: boolean;
}

/**
 * GET/POST prefs — tiny per-USER preferences (a `scpPrefsJson` User extension
 * property). Unlike every other endpoint these take NO project parameter: the
 * main-menu planner uses them to remember the caller's last-picked project
 * (the sandboxed widget iframe has no reliable localStorage).
 */
export interface UserPrefs {
  /** Key (shortName) of the project last picked in the main-menu planner. */
  lastProjectKey?: string | undefined;
  /** Team last picked per project key (multi-team projects reopen on that team). */
  lastTeamByProject?: Record<string, string> | undefined;
}
export interface SavePrefsRequest {
  /** New last-picked project key; null clears it; absent leaves it unchanged. */
  lastProjectKey?: string | null | undefined;
  /** Remember the last-picked team of a project; `teamId: null` forgets it. */
  lastTeam?: { projectKey: string; teamId: string | null } | undefined;
}

/** GET diagnostics (manager-only). */
export interface DiagnosticsResponse {
  correlationId: string;
  configured: boolean;
  configRevision: number;
  managedSprintCount: number;
  teams: Array<{
    teamId: string;
    sprints: Array<{ id: string; name: string; sequence: number; capacityRevision: number }>;
  }>;
}

// ---------------------------------------------------------------------------
// Widget-side request shapes (consumed by the ApiClient facade; the native parts
// are executed against YouTrack REST in the current user's context).
// ---------------------------------------------------------------------------

/** Capacity edit initiated from the capacity table. */
export interface PatchCapacityRequest {
  expectedRevision: number;
  availableMinutes?: number;
  note?: string;
}

/** "Create next Sprint" dialog submission. */
export interface CreateNextSprintRequest {
  /** Optional explicit goal for the new Sprint. */
  goal?: string;
  moveUnresolvedIssues: boolean;
}

/** Sprint details edit (name/goal/dates). */
export interface PatchSprintDetailsRequest {
  name?: string;
  goal?: string;
  /** yyyy-mm-dd. */
  start?: string;
  /** yyyy-mm-dd. */
  finish?: string;
}

/** Exclude-from-calibration dialog submission. */
export interface ExcludeCalibrationRequest {
  reason: string;
}

/** Plan an issue by dragging it on the board. */
export interface PlanIssueRequest {
  /** True to ensure the issue is in the Sprint; false to send it back to the backlog. */
  inSprint: boolean;
  /** Login to assign, or null to unassign (applied when in the Sprint). */
  assigneeId: string | null;
}

/** GET config/validation result (computed client-side from native data). */
export interface ConfigValidationResponse {
  valid: boolean;
  problems: Array<{ path: string; message: string }>;
}
