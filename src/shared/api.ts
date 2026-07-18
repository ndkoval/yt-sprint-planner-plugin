/**
 * HTTP API contract shared by the backend handlers and the widgets. See §18.
 *
 * This is the integration seam: the backend implements these shapes, the widgets
 * consume them. Every mutating payload is validated at runtime server-side against
 * the zod schemas in {@link ./api-schemas.ts}.
 */
import type {
  CapacityDocument,
  CompletionCalculation,
  DataIntegrityStatus,
  FocusFactorOverride,
  FocusFactorSource,
  ProjectConfig,
} from './types.js';

/** Structured error envelope returned for every non-2xx response (§18). */
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
  | 'BOARD_PERMISSION_REQUIRED'
  | 'SPRINT_ALREADY_EXISTS'
  | 'CALIBRATION_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** A native Sprint plus the app's computed/stored metrics. */
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

  metricsRevision: number;
  metricsDirty: boolean;
  dataIntegrityStatus: DataIntegrityStatus;
  lastWorkflowUpdateAt: number | null;
  lastRecalculatedAt: number | null;

  completion: CompletionCalculation | null;
  /** Ids of Sprint issues with no Original Effort (UI warning list). */
  issuesMissingOriginalEffort: string[];

  /** Per-assignee effort (keyed by user id) for per-person planning load. */
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

export interface SprintSummary {
  id: string;
  name: string;
  start: string;
  finish: string;
  archived: boolean;
  managed: boolean;
  /** App sequence number for managed Sprints; 0 for unmanaged. */
  sequence: number;
  /** Cached count of unresolved issues (for the carry-over preview); 0 for unmanaged. */
  unresolvedIssueCount: number;
}

/** GET /config */
export interface ConfigResponse {
  configured: boolean;
  configRevision: number;
  config: ProjectConfig | null;
  isManager: boolean;
}

/** PUT /config */
export interface PutConfigRequest {
  expectedRevision: number;
  config: ProjectConfig;
}

/** GET /config/validation */
export interface ConfigValidationResponse {
  valid: boolean;
  problems: Array<{ path: string; message: string }>;
}

/** PATCH /sprints/{id}/capacity/(me|{userId}) */
export interface PatchCapacityRequest {
  expectedRevision: number;
  availableMinutes?: number;
  note?: string;
}

/** POST /sprints/create-next */
export interface CreateNextSprintRequest {
  /** Optional explicit goal for the new Sprint. */
  goal?: string;
  moveUnresolvedIssues: boolean;
}

/** PATCH /sprints/{id}/details */
export interface PatchSprintDetailsRequest {
  name?: string;
  goal?: string;
  /** yyyy-mm-dd. */
  start?: string;
  /** yyyy-mm-dd. */
  finish?: string;
}

/** POST /sprints/{id}/focus-factor/override */
export interface OverrideFocusFactorRequest {
  reason: string;
  newValue: number;
}

/** POST /sprints/{id}/calibration/exclude */
export interface ExcludeCalibrationRequest {
  reason: string;
}

/** GET /diagnostics (manager-only). */
export interface DiagnosticsResponse {
  correlationId: string;
  managedSprintCount: number;
  dirtySprintIds: string[];
  lastReconciliationAt: number | null;
  problems: Array<{ sprintId: string; status: DataIntegrityStatus; detail: string }>;
}
