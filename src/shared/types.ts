/**
 * Shared domain types used across domain, backend and widgets.
 *
 * All timestamps are UTC epoch milliseconds. All effort/capacity values are minutes.
 * See {@link ./units.ts} for the unit policy.
 *
 * Users are identified by their YouTrack LOGIN everywhere (capacity rows, participants,
 * audit fields). The login is the one identity available identically to the widget
 * (`YTApp.me.login`), the in-process backend (`ctx.currentUser.login`), workflow rules
 * (`entities.User.findByLogin`) and the REST API.
 */

/** YouTrack user login. Primary key for capacity rows and participants. */
export type UserId = string;

/** Extension-property prefix owned by this app. */
export const SCP_PREFIX = 'scp';

/** Source of a Sprint's Focus Factor. */
export type FocusFactorSource = 'bootstrap' | 'calculated' | 'manual' | 'carried-forward';

/** Date scheduling policy for computing the next Sprint's dates. */
export type DatePolicy = 'continuous';

/**
 * One person's capacity for a specific Sprint.
 * Persisted inside {@link CapacityDocument.rows}, keyed by user login.
 */
export interface CapacityRow {
  /** User login (primary key). */
  userId: UserId;
  /** Display name at the time the row was created (snapshot; may drift). */
  displayNameSnapshot: string;
  /** Default capacity in minutes, derived from working days × hours × allocation. */
  defaultMinutes: number;
  /** Available capacity in minutes; defaults to defaultMinutes until customized. */
  availableMinutes: number;
  /** True once available diverges from default (blocks auto-reset on date change). */
  availableWasCustomized: boolean;
  /** Free-text note (e.g. "Vacation"). */
  note: string;
  /** UTC ms of last edit to this row. */
  updatedAt: number;
  /** Login of the user who last edited this row. */
  updatedBy: UserId;
}

/** Versioned capacity document stored inside a Sprint's {@link SprintEntry}. */
export interface CapacityDocument {
  version: 2;
  /** Config revision the rows were seeded from. */
  createdFromConfigVersion: number;
  /** Rows keyed by user login. */
  rows: Record<UserId, CapacityRow>;
}

/** A completed Sprint's calculation, computed live from the current issue set. */
export interface CompletionCalculation {
  calculatedAt: number;
  sprintStart: number;
  sprintFinish: number;
  rawCapacityMinutes: number;
  originalEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  /** null when raw capacity is 0. */
  observedFocusFactor: number | null;
}

/** Record of a manual Focus Factor override (kept inside {@link SprintEntry}). */
export interface FocusFactorOverride {
  reason: string;
  oldValue: number;
  newValue: number;
  /** Login of the manager who overrode. */
  userId: UserId;
  timestamp: number;
}

/** One participant in the configured team. */
export interface Participant {
  /** User login. */
  userId: UserId;
  enabled: boolean;
  /**
   * Fraction of a full-time schedule this person is available for (0 < allocation ≤ 1).
   * 1 = full-time (the default); 0.5 = half-time. Scales the person's default capacity.
   */
  allocation: number;
  // `| undefined` matches how the zod schema infers this optional, so parsed
  // configs are assignable under exactOptionalPropertyTypes.
  note?: string | undefined;
}

/** Project configuration document (persisted inside {@link ConfigDocument}). */
export interface ProjectConfig {
  version: 2;
  boardId: string;
  originalEffortField: string;
  currentEffortField: string;
  hoursPerDay: number;
  sprintLengthDays: number;
  datePolicy: DatePolicy;
  nameTemplate: string;
  /**
   * YouTrack search query defining the planning backlog — the pool of issues you can pull
   * into a Sprint from the board's backlog lane. Issues already in the Sprint are excluded
   * automatically. Empty disables the backlog lane. E.g. `project: AGP State: Open`.
   */
  backlogQuery: string;
  /**
   * Learning rate (0 < α ≤ 1): how strongly each new Sprint's Focus Factor moves toward
   * the previous Sprint's observed factor. New Sprints start at the bootstrap factor
   * and are then calibrated by this rate (see the focus-factor domain).
   */
  learningRate: number;
  participants: Participant[];
  /**
   * Name of the YouTrack group whose members are Capacity Managers (may plan Sprints and
   * edit settings). Optional; while unset, only the project leader can change settings.
   */
  managersGroup?: string | undefined;
}

/** Focus Factor tuning, extracted from config for the calculation layer. */
export interface FocusFactorSettings {
  learningRate: number;
}

// ---------------------------------------------------------------------------
// Persisted project-scoped documents (Project extension properties).
// ---------------------------------------------------------------------------

/** The `scpConfigJson` project extension property. */
export interface ConfigDocument {
  version: 2;
  /** Optimistic-concurrency revision of the config. */
  revision: number;
  config: ProjectConfig;
}

/**
 * App-owned state for one managed Sprint, stored inside {@link SprintDataDocument}.
 * `name`/`start`/`finish` are snapshots of the native Sprint (refreshed on register);
 * the native Sprint remains the source of truth for membership and dates.
 */
export interface SprintEntry {
  /** App sequence number (1-based, unique per project). */
  sequence: number;
  name: string;
  /** yyyy-mm-dd. */
  start: string;
  /** yyyy-mm-dd. */
  finish: string;
  capacityRevision: number;
  capacity: CapacityDocument;
  focusFactor: number;
  focusFactorSource: FocusFactorSource;
  focusFactorOverride: FocusFactorOverride | null;
  excludedFromCalibration: boolean;
  calibrationSkipReason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** The `scpSprintDataJson` project extension property: all managed Sprints' app state. */
export interface SprintDataDocument {
  version: 2;
  /** Entries keyed by the native Sprint's id. */
  sprints: Record<string, SprintEntry>;
}
