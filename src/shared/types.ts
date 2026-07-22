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
 * Team id assigned by the v2→v3 migration to the project's original flat participant
 * list. Also the first id `newTeamId` generates in an empty config.
 */
export const DEFAULT_TEAM_ID = 'team-1';

/** Hard cap on teams per project — the UI is designed for a handful of small teams. */
export const MAX_TEAMS = 20;

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

/** Versioned capacity document stored inside a {@link TeamSprint}. */
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

/** Record of a manual Focus Factor override (kept inside {@link TeamSprint}). */
export interface FocusFactorOverride {
  reason: string;
  oldValue: number;
  newValue: number;
  /** Login of the manager who overrode. */
  userId: UserId;
  timestamp: number;
}

/** One participant of a team. */
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

/**
 * A small team planning independently within the project. Since config v4 the team
 * owns its ENTIRE planning configuration — board, Sprint cadence and naming, effort
 * fields, backlog query, Focus Factor learning rate, reminder lead — so different
 * teams of one project can plan on different boards with different cadences; nothing
 * is shared between teams except the project itself. The SAME person may belong to
 * several teams (a shared specialist): they get an independent capacity row (and
 * allocation) in each team, and their assigned issues count toward every team whose
 * Sprint contains them.
 */
export interface Team {
  /** Stable id, unique per project. Generated once and never renamed. */
  id: string;
  /** Display name, unique per project (case-insensitive). */
  name: string;
  participants: Participant[];
  /** The agile board this team plans on. Teams may share a board or use their own. */
  boardId: string;
  /** Name of the estimation field (project custom field, period type). */
  originalEffortField: string;
  /** Name of the remaining-effort field. */
  currentEffortField: string;
  hoursPerDay: number;
  sprintLengthDays: number;
  datePolicy: DatePolicy;
  /** Sprint name template; placeholders {year} {sequence} {startDate} {finishDate}. */
  nameTemplate: string;
  /**
   * YouTrack search query defining this team's planning backlog — the pool of issues
   * the team can pull into a Sprint from the board's backlog lane. Issues already in
   * the Sprint are excluded automatically. Empty disables the backlog lane.
   */
  backlogQuery: string;
  /**
   * Learning rate (0 < α ≤ 1): how strongly each new Sprint's Focus Factor moves
   * toward the previous Sprint's observed factor (see the focus-factor domain).
   */
  learningRate: number;
  /**
   * Per-team override of the app-level `reminderLeadDays` setting (days before a
   * Sprint starts to remind participants who kept the default availability).
   * 0 disables reminders for this team. Absent means "use the app default".
   */
  reminderLeadDays?: number | undefined;
  /**
   * Optional name of a single-enum custom field mirroring Sprint membership (teams
   * that also track Sprints in a field, e.g. for queries/reports). When set, every
   * planning move keeps it in sync: pulling an issue into the Sprint (assigned or
   * not) sets the field to the Sprint's name, dropping it back to the backlog
   * clears it, and carry-over rewrites it to the new Sprint. Absent/empty = off.
   */
  sprintFieldName?: string | undefined;
}

/**
 * Project configuration document (persisted inside {@link ConfigDocument}).
 * Since v4 the project level holds ONLY the team list — every planning setting
 * belongs to a {@link Team}. Teams (like everything here) are edited only by
 * MANAGERS — users with YouTrack's own `UPDATE_PROJECT` permission on the project
 * (or its leader); the app defines no permission scheme of its own.
 */
export interface ProjectConfig {
  version: 4;
  /** The project's teams (1..MAX_TEAMS). Single-team projects see no team chrome. */
  teams: Team[];
}

/** Focus Factor tuning, extracted from a team's config for the calculation layer. */
export interface FocusFactorSettings {
  learningRate: number;
}

// ---------------------------------------------------------------------------
// Persisted project-scoped documents (Project extension properties).
// ---------------------------------------------------------------------------

/** The `scpConfigJson` project extension property. */
export interface ConfigDocument {
  version: 4;
  /** Optimistic-concurrency revision of the config. */
  revision: number;
  config: ProjectConfig;
}

/**
 * One team's app-owned state for one of its managed Sprints, stored inside
 * {@link TeamSprints.sprints}. `name`/`start`/`finish` are snapshots of the native
 * Sprint (refreshed on register); the native Sprint remains the source of truth for
 * membership and dates.
 */
export interface TeamSprint {
  /** App sequence number (1-based, unique per team). */
  sequence: number;
  name: string;
  /** yyyy-mm-dd. */
  start: string;
  /** yyyy-mm-dd. */
  finish: string;
  /** Optimistic-concurrency revision of this Sprint's capacity document. */
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

/** One team's managed Sprints, keyed by the native Sprint's id (on the team's board). */
export interface TeamSprints {
  sprints: Record<string, TeamSprint>;
}

/**
 * The `scpSprintDataJson` project extension property: every team's managed-Sprint
 * state, keyed by {@link Team.id}. Entries of teams no longer present in the config
 * are RETAINED (non-destructive) but hidden from views.
 */
export interface SprintDataDocument {
  version: 4;
  teams: Record<string, TeamSprints>;
}
