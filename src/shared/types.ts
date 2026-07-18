/**
 * Shared domain types used across domain, backend and widgets.
 *
 * All timestamps are UTC epoch milliseconds. All effort/capacity values are minutes.
 * See {@link ./units.ts} for the unit policy.
 */

/** Stable YouTrack user id, e.g. "1-123". Primary key for capacity rows. */
export type UserId = string;

/** Extension-property prefix owned by this app. */
export const SCP_PREFIX = 'scp';

/** Source of a Sprint's Focus Factor. */
export type FocusFactorSource = 'bootstrap' | 'calculated' | 'manual' | 'carried-forward';

/** Health of a Sprint's cached metrics. */
export type DataIntegrityStatus =
  | 'up-to-date'
  | 'incremental'
  | 'needs-recalculation'
  | 'recalculating'
  | 'error';

/** Date scheduling policy for computing the next Sprint's dates. */
export type DatePolicy = 'continuous';

/** Partial-progress marker for idempotent next-Sprint creation. */
export type CreateSprintStage =
  | 'native-created'
  | 'properties-initialized'
  | 'capacity-initialized'
  | 'recalculated'
  | 'complete';

/**
 * One person's capacity for a specific Sprint.
 * Persisted inside {@link CapacityDocument.rows}, keyed by userId.
 */
export interface CapacityRow {
  userId: UserId;
  /** Login at the time the row was created (snapshot; may drift from live login). */
  loginSnapshot: string;
  /** Display name at the time the row was created (snapshot). */
  displayNameSnapshot: string;
  /** Default capacity in minutes, derived from working days × hours (everyone is 100%). */
  defaultMinutes: number;
  /** Available capacity in minutes; defaults to defaultMinutes until customized. */
  availableMinutes: number;
  /** True once available diverges from default (blocks auto-reset on date change). */
  availableWasCustomized: boolean;
  /** Free-text note (e.g. "Vacation"). */
  note: string;
  /** UTC ms of last edit to this row. */
  updatedAt: number;
  /** User id who last edited this row. */
  updatedBy: UserId;
}

/** Versioned capacity document stored as JSON on the Sprint (scpCapacityJson). */
export interface CapacityDocument {
  version: 1;
  /** Config revision the rows were seeded from. */
  createdFromConfigVersion: number;
  /** Rows keyed by stable userId. */
  rows: Record<UserId, CapacityRow>;
}

/** Snapshot of a completed Sprint's calculation (scpCompletionCalculationJson). */
export interface CompletionCalculation {
  version: 1;
  calculatedAt: number;
  sprintStart: number;
  sprintFinish: number;
  rawCapacityMinutes: number;
  originalEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  /** null when raw capacity is 0. */
  observedFocusFactor: number | null;
  calculationRevision: number;
}

/** Per-issue snapshot used by workflows for delta calculations (scpMetricsSnapshotJson). */
export interface IssueSnapshot {
  version: 1;
  /** Managed Sprint ids this issue currently belongs to. */
  managedSprintIds: string[];
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  resolved: boolean;
  /** UTC ms the issue was resolved, or null if unresolved. */
  resolvedAt: number | null;
  updatedAt: number;
}

/** Record of a manual Focus Factor override (scpFocusFactorOverrideJson). */
export interface FocusFactorOverride {
  reason: string;
  oldValue: number;
  newValue: number;
  userId: UserId;
  timestamp: number;
}

/** One participant in the configured team. Everyone is allocated at 100%. */
export interface Participant {
  userId: UserId;
  enabled: boolean;
  // `| undefined` matches how the zod schema infers this optional, so parsed
  // configs are assignable under exactOptionalPropertyTypes.
  note?: string | undefined;
}

/** Project configuration document (scpConfigJson). */
export interface ProjectConfig {
  version: 1;
  boardId: string;
  originalEffortField: string;
  currentEffortField: string;
  hoursPerDay: number;
  sprintLengthDays: number;
  /** ISO date (yyyy-mm-dd) of the first Sprint's start, in the board timezone. */
  firstSprintStart: string;
  datePolicy: DatePolicy;
  nameTemplate: string;
  bootstrapFocusFactor: number;
  learningRate: number;
  maxFactorStep: number;
  minFocusFactor: number;
  maxFocusFactor: number;
  participants: Participant[];
  /**
   * Name of the YouTrack group whose members are Capacity Managers (may plan Sprints and
   * edit settings). Optional; when unset, only the first-run bootstrap (a board admin) can
   * change settings. Persisted as the `scpCapacityManagers` project extension property.
   */
  managersGroup?: string | undefined;
}

/** Focus Factor bounds + tuning, extracted from config for the calculation layer. */
export interface FocusFactorSettings {
  bootstrapFocusFactor: number;
  learningRate: number;
  maxFactorStep: number;
  minFocusFactor: number;
  maxFocusFactor: number;
}
