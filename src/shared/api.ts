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
  SprintEntry,
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

/** A native Sprint plus the app's stored state and live-computed metrics. */
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

  capacityRevision: number;
  capacity: CapacityDocument;

  focusFactor: number;
  focusFactorSource: FocusFactorSource;
  focusFactorOverride: FocusFactorOverride | null;

  rawCapacityMinutes: number;
  plannedCapacityMinutes: number;

  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  observedFocusFactor: number | null;

  excludedFromCalibration: boolean;
  calibrationSkipReason: string | null;

  /** UTC ms when these metrics were computed (metrics are always computed live). */
  computedAt: number;

  /** Live completion figures once the Sprint's finish day has passed, else null. */
  completion: CompletionCalculation | null;
  /** Ids of Sprint issues with no Original Effort (UI warning list). */
  issuesMissingOriginalEffort: string[];

  /** Per-assignee effort (keyed by user login) for per-person planning load. */
  assignedEffort: Record<string, AssigneeEffortView>;
  /** Effort on issues left unassigned (preserving project-direction ownership). */
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

/** GET sprint-data */
export interface SprintDataResponse {
  sprints: Record<string, SprintEntry>;
}

/**
 * POST sprint-register — upsert the app state for a native Sprint. Called after the
 * widget creates a Sprint (seeds sequence + capacity) and after date/name edits
 * (refreshes snapshots; non-customized capacity rows track the new default).
 */
export interface RegisterSprintRequest {
  sprint: { id: string; name: string; start: string; finish: string };
  /** Focus factor for a NEW entry (computed by the manager's client from history). */
  focusFactor?: number | undefined;
  focusFactorSource?: FocusFactorSource | undefined;
}

/** POST capacity */
export interface CapacityWriteRequest {
  sprintId: string;
  /** 'me' resolves to the caller server-side; a login targets another row (manager-only). */
  target: 'me' | { userId: string };
  expectedRevision: number;
  availableMinutes?: number | undefined;
  note?: string | undefined;
}

/** POST capacity-reset */
export interface CapacityResetRequest {
  sprintId: string;
  userId: string;
  expectedRevision: number;
}

/** POST focus-factor */
export interface OverrideFocusFactorRequest {
  sprintId: string;
  reason: string;
  newValue: number;
}

/** POST calibration */
export interface SetCalibrationRequest {
  sprintId: string;
  excluded: boolean;
  /** Required when excluding. */
  reason?: string | undefined;
}

/** GET export */
export interface ExportBundle {
  exportedAt: number;
  configRevision: number;
  config: ProjectConfig | null;
  sprints: Record<string, SprintEntry>;
}

/** POST import */
export interface ImportRequest {
  bundle: ExportBundle;
  dryRun: boolean;
}
export interface ImportResult {
  applied: boolean;
  sprintCount: number;
  configured: boolean;
}

/** GET diagnostics (manager-only). */
export interface DiagnosticsResponse {
  correlationId: string;
  configured: boolean;
  configRevision: number;
  managedSprintCount: number;
  sprints: Array<{ id: string; name: string; sequence: number; capacityRevision: number }>;
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
