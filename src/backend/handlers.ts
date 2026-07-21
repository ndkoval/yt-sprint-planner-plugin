/**
 * Backend request handlers: app-owned state (config, per-team capacity, focus factor,
 * calibration, export/import) over project extension properties.
 *
 * Handlers are pure with respect to YouTrack: they reach it only through
 * {@link BackendEnv}/{@link BackendProject}/{@link BackendUser}, so contract tests can
 * drive them with fakes. Every mutation is authorized here, server-side, from the
 * REAL caller (`ctx.currentUser`) — widget-side checks are never trusted.
 *
 * Native YouTrack data (boards, sprints, issues) is deliberately absent: the widget
 * reads and writes it through the current user's own REST session (`host.fetchYouTrack`),
 * so YouTrack enforces the caller's real permissions.
 *
 * Team scoping: every team-scoped mutation resolves its target team from the config —
 * an explicit `teamId`, or the config's ONLY team when omitted (ambiguous with several
 * teams → VALIDATION_FAILED). Teams added to the config after a Sprint was registered
 * are materialized lazily (with capacityRevision 0, matching the empty view the client
 * synthesizes) on their first write or on the next sprint-register. Entries of teams
 * REMOVED from the config are retained in storage (non-destructive) but never touched.
 */
import {
  DEFAULT_FOCUS_FACTOR,
  canChangeCalibration,
  canCreateSprint,
  canEditCapacityRow,
  canEditSettings,
  canImportExport,
  canOverrideFocusFactor,
  canReadDiagnostics,
  nextSequence,
  reapplyDefaults,
  resolveTeam,
  seedCapacityDocument,
  type Principal,
} from '../domain/index.js';
import type {
  CapacityResetRequest,
  CapacityWriteRequest,
  ConfigResponse,
  DiagnosticsResponse,
  ExportBundle,
  ImportRequest,
  ImportResult,
  OverrideFocusFactorRequest,
  PutConfigRequest,
  RegisterSprintRequest,
  SavePrefsRequest,
  SetCalibrationRequest,
  SprintDataResponse,
  UserPrefs,
} from '../shared/api.js';
import type {
  CapacityRow,
  ProjectConfig,
  SprintEntry,
  Team,
  TeamSprintEntry,
} from '../shared/types.js';
import { AppError, capacityConflict, configConflict, forbidden, notConfigured, notFound } from './errors.js';
import type { BackendEnv, BackendProject, BackendUser } from './env.js';
import {
  loadConfigDocument,
  loadSprintData,
  normalizeConfigDocument,
  normalizeSprintData,
  saveConfigDocument,
  saveSprintData,
} from './storage.js';

/** Everything resolved once per request. */
export interface RequestContext {
  env: BackendEnv;
  user: BackendUser;
  project: BackendProject;
}

/**
 * Resolve the caller's principal. A manager is whoever may change the PROJECT's
 * settings — YouTrack's own `UPDATE_PROJECT` permission (no app-specific permission
 * scheme) — plus the project leader as a bootstrap. Managers manage ALL teams.
 */
export function resolvePrincipal(ctx: RequestContext): Principal {
  const isLeader = ctx.project.leaderLogin !== null && ctx.project.leaderLogin === ctx.user.login;
  return {
    userId: ctx.user.login,
    isManager: isLeader || ctx.user.canUpdateProject(ctx.project),
  };
}

/** Load config + principal; throws NOT_CONFIGURED when no config exists. */
function requireConfig(ctx: RequestContext): { config: ProjectConfig; principal: Principal } {
  const doc = loadConfigDocument(ctx.project);
  if (!doc) throw notConfigured();
  return { config: doc.config, principal: resolvePrincipal(ctx) };
}

/** Resolve the targeted team or fail with a clear validation error. */
function requireTeam(config: ProjectConfig, teamId: string | undefined): Team {
  const team = resolveTeam(config, teamId);
  if (team) return team;
  throw new AppError(
    'VALIDATION_FAILED',
    teamId === undefined
      ? 'This project has several teams — specify which team the request targets.'
      : `Unknown team "${teamId}".`,
    { teamId: teamId ?? null, knownTeams: config.teams.map((t) => t.id) },
  );
}

function requireEntry(ctx: RequestContext, sprintId: string): SprintEntry {
  const data = loadSprintData(ctx.project);
  const entry = data.sprints[sprintId];
  if (!entry) throw notFound(`Sprint ${sprintId}`);
  return entry;
}

function saveEntry(ctx: RequestContext, sprintId: string, entry: SprintEntry): SprintEntry {
  const data = loadSprintData(ctx.project);
  data.sprints[sprintId] = entry;
  saveSprintData(ctx.project, data);
  return entry;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(ctx: RequestContext): ConfigResponse {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx);
  return {
    configured: doc !== null,
    configRevision: doc?.revision ?? 0,
    config: doc?.config ?? null,
    isManager: principal.isManager,
    isProjectLeader: ctx.project.leaderLogin === ctx.user.login,
    me: { login: ctx.user.login, name: ctx.user.name },
  };
}

export function putConfig(ctx: RequestContext, body: PutConfigRequest): ConfigResponse {
  const existing = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx);
  if (!canEditSettings(principal)) {
    throw forbidden('Only managers can change settings.');
  }
  const currentRevision = existing?.revision ?? 0;
  if (body.expectedRevision !== currentRevision) throw configConflict();
  const newRevision = currentRevision + 1;
  saveConfigDocument(ctx.project, { version: 3, revision: newRevision, config: body.config });
  // Roster changes take effect IMMEDIATELY: seed entries for teams added to the
  // config and capacity rows for participants who joined, across every managed
  // Sprint — so new members/teams show up on the planner right after saving,
  // not only after the next sprint-register.
  reconcileSprintsWithConfig(ctx, body.config);
  return {
    configured: true,
    configRevision: newRevision,
    config: body.config,
    isManager: resolvePrincipal(ctx).isManager,
    isProjectLeader: ctx.project.leaderLogin === ctx.user.login,
    me: { login: ctx.user.login, name: ctx.user.name },
  };
}

/**
 * Backfill every managed Sprint's per-team state against the CURRENT config:
 * config teams missing an entry are seeded; enabled participants missing a row are
 * added (revision bumps per changed team). Existing rows, removed teams' entries
 * and everything the user customized stay untouched.
 */
function reconcileSprintsWithConfig(ctx: RequestContext, config: ProjectConfig): void {
  const data = loadSprintData(ctx.project);
  const now = ctx.env.now();
  let anyChanged = false;
  for (const [sprintId, entry] of Object.entries(data.sprints)) {
    const teams: Record<string, TeamSprintEntry> = { ...entry.teams };
    let changed = false;
    for (const team of config.teams) {
      const teamEntry = teams[team.id];
      if (!teamEntry) {
        teams[team.id] = seedTeamEntry(
          ctx,
          config,
          team,
          entry.start,
          entry.finish,
          now,
          { focusFactor: DEFAULT_FOCUS_FACTOR, focusFactorSource: 'bootstrap' },
          1,
        );
        changed = true;
        continue;
      }
      const seeded = seedCapacityDocument(
        team,
        config.hoursPerDay,
        participantNames(ctx, team),
        entry.start,
        entry.finish,
        now,
      );
      const rows: Record<string, CapacityRow> = { ...teamEntry.capacity.rows };
      let rowsAdded = false;
      for (const [login, row] of Object.entries(seeded.rows)) {
        if (!(login in rows)) {
          rows[login] = row;
          rowsAdded = true;
        }
      }
      if (rowsAdded) {
        teams[team.id] = {
          ...teamEntry,
          capacity: { ...teamEntry.capacity, rows },
          capacityRevision: teamEntry.capacityRevision + 1,
        };
        changed = true;
      }
    }
    if (changed) {
      data.sprints[sprintId] = { ...entry, teams, updatedAt: now };
      anyChanged = true;
    }
  }
  if (anyChanged) saveSprintData(ctx.project, data);
}

// ---------------------------------------------------------------------------
// Sprint app-state
// ---------------------------------------------------------------------------

export function getSprintData(ctx: RequestContext): SprintDataResponse {
  return { sprints: loadSprintData(ctx.project).sprints };
}

/** Display names for a team's enabled participants (login fallback). */
function participantNames(ctx: RequestContext, team: Team): Record<string, string> {
  const names: Record<string, string> = {};
  for (const p of team.participants) {
    if (p.enabled) names[p.userId] = ctx.env.findUserNameByLogin(p.userId) ?? p.userId;
  }
  return names;
}

function allocationByUser(team: Team): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of team.participants) out[p.userId] = p.allocation ?? 1;
  return out;
}

/** A fresh per-team entry for a Sprint (used by register and by lazy materialization). */
function seedTeamEntry(
  ctx: RequestContext,
  config: ProjectConfig,
  team: Team,
  start: string,
  finish: string,
  now: number,
  seed: { focusFactor: number; focusFactorSource: TeamSprintEntry['focusFactorSource'] },
  capacityRevision: number,
): TeamSprintEntry {
  return {
    capacityRevision,
    capacity: seedCapacityDocument(
      team,
      config.hoursPerDay,
      participantNames(ctx, team),
      start,
      finish,
      now,
    ),
    focusFactor: seed.focusFactor,
    focusFactorSource: seed.focusFactorSource,
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
  };
}

/**
 * The team's entry in a Sprint, materialized lazily when the team joined the config
 * after the Sprint was registered. The lazy entry starts at capacityRevision 0 —
 * matching the empty view the client synthesizes — so the caller's expectedRevision 0
 * passes and the first write bumps it to 1.
 */
function materializeTeamEntry(
  ctx: RequestContext,
  config: ProjectConfig,
  team: Team,
  entry: SprintEntry,
): TeamSprintEntry {
  return (
    entry.teams[team.id] ??
    seedTeamEntry(
      ctx,
      config,
      team,
      entry.start,
      entry.finish,
      ctx.env.now(),
      { focusFactor: DEFAULT_FOCUS_FACTOR, focusFactorSource: 'bootstrap' },
      0,
    )
  );
}

/**
 * Upsert the app state for a native Sprint. New entries get a sequence and one seeded
 * {@link TeamSprintEntry} per config team; existing entries refresh their name/date
 * snapshots — when dates change, each team's non-customized rows track the recomputed
 * default. Enabled participants missing a row, and config teams missing an entry, are
 * added on every call, so config changes propagate. Entries of removed teams are kept.
 */
export function registerSprint(
  ctx: RequestContext,
  body: RegisterSprintRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  if (!canCreateSprint(principal)) throw forbidden('Only managers can plan Sprints.');
  if (body.sprint.finish <= body.sprint.start) {
    throw new AppError('VALIDATION_FAILED', 'Finish must be after start.');
  }

  const now = ctx.env.now();
  const data = loadSprintData(ctx.project);
  const existing = data.sprints[body.sprint.id];

  const factorSeed = (team: Team): { focusFactor: number; focusFactorSource: TeamSprintEntry['focusFactorSource'] } => {
    const seed = body.teams?.[team.id];
    return {
      focusFactor: seed?.focusFactor ?? DEFAULT_FOCUS_FACTOR,
      focusFactorSource: seed?.focusFactorSource ?? 'bootstrap',
    };
  };

  let entry: SprintEntry;
  if (!existing) {
    const teams: Record<string, TeamSprintEntry> = {};
    for (const team of config.teams) {
      teams[team.id] = seedTeamEntry(
        ctx,
        config,
        team,
        body.sprint.start,
        body.sprint.finish,
        now,
        factorSeed(team),
        1,
      );
    }
    entry = {
      sequence: nextSequence(Object.values(data.sprints).map((e) => e.sequence)),
      name: body.sprint.name,
      start: body.sprint.start,
      finish: body.sprint.finish,
      teams,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const datesChanged =
      existing.start !== body.sprint.start || existing.finish !== body.sprint.finish;
    const teams: Record<string, TeamSprintEntry> = { ...existing.teams };
    for (const team of config.teams) {
      const teamEntry = teams[team.id];
      if (!teamEntry) {
        // A team added to the config after this Sprint was registered.
        teams[team.id] = seedTeamEntry(
          ctx,
          config,
          team,
          body.sprint.start,
          body.sprint.finish,
          now,
          factorSeed(team),
          1,
        );
        continue;
      }
      let capacity = teamEntry.capacity;
      if (datesChanged) {
        capacity = reapplyDefaults(
          capacity,
          body.sprint.start,
          body.sprint.finish,
          config.hoursPerDay,
          allocationByUser(team),
        );
      }
      // Add rows for enabled participants that joined the team after seeding.
      const seeded = seedCapacityDocument(
        team,
        config.hoursPerDay,
        participantNames(ctx, team),
        body.sprint.start,
        body.sprint.finish,
        now,
      );
      const rows: Record<string, CapacityRow> = { ...capacity.rows };
      let rowsAdded = false;
      for (const [login, row] of Object.entries(seeded.rows)) {
        if (!(login in rows)) {
          rows[login] = row;
          rowsAdded = true;
        }
      }
      const capacityChanged = datesChanged || rowsAdded;
      teams[team.id] = {
        ...teamEntry,
        capacity: { ...capacity, rows },
        capacityRevision: capacityChanged
          ? teamEntry.capacityRevision + 1
          : teamEntry.capacityRevision,
      };
    }
    entry = {
      ...existing,
      name: body.sprint.name,
      start: body.sprint.start,
      finish: body.sprint.finish,
      teams,
      updatedAt: now,
    };
  }

  data.sprints[body.sprint.id] = entry;
  saveSprintData(ctx.project, data);
  return { sprintId: body.sprint.id, entry };
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/** Persist an updated team entry inside its Sprint entry. */
function withTeamEntry(
  entry: SprintEntry,
  teamId: string,
  teamEntry: TeamSprintEntry,
  now: number,
): SprintEntry {
  return { ...entry, teams: { ...entry.teams, [teamId]: teamEntry }, updatedAt: now };
}

export function writeCapacity(
  ctx: RequestContext,
  body: CapacityWriteRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  const team = requireTeam(config, body.teamId);
  const target = body.target === 'me' ? ctx.user.login : body.target.userId;
  if (!canEditCapacityRow(principal, { targetUserId: target })) {
    throw forbidden('You can only edit your own availability.');
  }
  const entry = requireEntry(ctx, body.sprintId);
  const teamEntry = materializeTeamEntry(ctx, config, team, entry);
  if (body.expectedRevision !== teamEntry.capacityRevision) throw capacityConflict();

  let row = teamEntry.capacity.rows[target];
  if (!row) {
    // A participant added to the team after this Sprint was seeded gets a row on
    // their first edit; non-members of THIS team have no capacity here.
    const participant = team.participants.find((p) => p.enabled && p.userId === target);
    if (!participant) throw notFound(`Capacity row for user ${target} in team ${team.name}`);
    const seeded = seedCapacityDocument(
      team,
      config.hoursPerDay,
      { [target]: ctx.env.findUserNameByLogin(target) ?? target },
      entry.start,
      entry.finish,
      ctx.env.now(),
    );
    row = seeded.rows[target]!;
  }

  const now = ctx.env.now();
  const updated: CapacityRow = { ...row, updatedAt: now, updatedBy: ctx.user.login };
  if (body.availableMinutes !== undefined) {
    updated.availableMinutes = body.availableMinutes;
    // Any explicit edit marks the row customized so date changes won't overwrite it.
    updated.availableWasCustomized = body.availableMinutes !== row.defaultMinutes;
  }
  if (body.note !== undefined) updated.note = body.note;

  const nextTeamEntry: TeamSprintEntry = {
    ...teamEntry,
    capacity: { ...teamEntry.capacity, rows: { ...teamEntry.capacity.rows, [target]: updated } },
    capacityRevision: teamEntry.capacityRevision + 1,
  };
  const next = withTeamEntry(entry, team.id, nextTeamEntry, now);
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

export function resetCapacity(
  ctx: RequestContext,
  body: CapacityResetRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  const team = requireTeam(config, body.teamId);
  if (!canEditCapacityRow(principal, { targetUserId: body.userId })) {
    throw forbidden('You can only reset your own availability.');
  }
  const entry = requireEntry(ctx, body.sprintId);
  const teamEntry = entry.teams[team.id];
  if (!teamEntry) throw notFound(`Capacity for team ${team.name} in Sprint ${body.sprintId}`);
  if (body.expectedRevision !== teamEntry.capacityRevision) throw capacityConflict();
  const row = teamEntry.capacity.rows[body.userId];
  if (!row) throw notFound(`Capacity row for user ${body.userId}`);

  const now = ctx.env.now();
  const updated: CapacityRow = {
    ...row,
    availableMinutes: row.defaultMinutes,
    availableWasCustomized: false,
    updatedAt: now,
    updatedBy: ctx.user.login,
  };
  const nextTeamEntry: TeamSprintEntry = {
    ...teamEntry,
    capacity: { ...teamEntry.capacity, rows: { ...teamEntry.capacity.rows, [body.userId]: updated } },
    capacityRevision: teamEntry.capacityRevision + 1,
  };
  const next = withTeamEntry(entry, team.id, nextTeamEntry, now);
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

// ---------------------------------------------------------------------------
// Focus factor & calibration
// ---------------------------------------------------------------------------

export function overrideFocusFactor(
  ctx: RequestContext,
  body: OverrideFocusFactorRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  if (!canOverrideFocusFactor(principal)) throw forbidden('Only managers can override.');
  const team = requireTeam(config, body.teamId);
  const entry = requireEntry(ctx, body.sprintId);
  const teamEntry = materializeTeamEntry(ctx, config, team, entry);
  const now = ctx.env.now();
  const nextTeamEntry: TeamSprintEntry = {
    ...teamEntry,
    focusFactor: body.newValue,
    focusFactorSource: 'manual',
    focusFactorOverride: {
      reason: body.reason,
      oldValue: teamEntry.focusFactor,
      newValue: body.newValue,
      userId: ctx.user.login,
      timestamp: now,
    },
  };
  const next = withTeamEntry(entry, team.id, nextTeamEntry, now);
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

export function setCalibration(
  ctx: RequestContext,
  body: SetCalibrationRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  if (!canChangeCalibration(principal)) throw forbidden('Only managers can change calibration.');
  const team = requireTeam(config, body.teamId);
  const entry = requireEntry(ctx, body.sprintId);
  const teamEntry = materializeTeamEntry(ctx, config, team, entry);
  const now = ctx.env.now();
  const nextTeamEntry: TeamSprintEntry = {
    ...teamEntry,
    excludedFromCalibration: body.excluded,
    calibrationSkipReason: body.excluded ? (body.reason ?? '') : null,
  };
  const next = withTeamEntry(entry, team.id, nextTeamEntry, now);
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

// ---------------------------------------------------------------------------
// Per-user preferences (no project scope — see UserPrefs in shared/api.ts)
// ---------------------------------------------------------------------------

const PREFS_PROP = 'scpPrefsJson';

export function getPrefs(user: BackendUser): UserPrefs {
  const raw = user.getProperty(PREFS_PROP);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as { lastProjectKey?: unknown };
    return typeof parsed.lastProjectKey === 'string'
      ? { lastProjectKey: parsed.lastProjectKey }
      : {};
  } catch {
    return {};
  }
}

export function savePrefs(user: BackendUser, body: SavePrefsRequest): UserPrefs {
  const prefs: UserPrefs =
    body.lastProjectKey === null ? {} : { lastProjectKey: body.lastProjectKey };
  user.setProperty(PREFS_PROP, Object.keys(prefs).length > 0 ? JSON.stringify(prefs) : null);
  return prefs;
}

// ---------------------------------------------------------------------------
// Export / import / diagnostics
// ---------------------------------------------------------------------------

export function getExport(ctx: RequestContext): ExportBundle {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx);
  if (!canImportExport(principal)) throw forbidden('Only managers can export.');
  return {
    exportedAt: ctx.env.now(),
    configRevision: doc?.revision ?? 0,
    config: doc?.config ?? null,
    sprints: loadSprintData(ctx.project).sprints,
  };
}

export function postImport(ctx: RequestContext, body: ImportRequest): ImportResult {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx);
  if (!canImportExport(principal)) throw forbidden('Only managers can import.');

  // Accept bundles from ANY supported schema era: wrap the bundle's documents into
  // their persisted-document shapes and run the same migrate-then-validate path the
  // storage layer uses. A v0.2.0 (pre-teams) export imports fine this way.
  const rawConfig = body.bundle.config ?? null;
  const configVersion =
    rawConfig !== null && typeof rawConfig === 'object'
      ? (rawConfig as { version?: unknown }).version
      : null;
  const configDoc =
    rawConfig === null
      ? null
      : normalizeConfigDocument({ version: configVersion, revision: 0, config: rawConfig });
  if (rawConfig !== null && configDoc === null) {
    throw new AppError('VALIDATION_FAILED', 'The bundle config is not a supported document.');
  }

  const rawSprints = body.bundle.sprints;
  if (rawSprints === null || typeof rawSprints !== 'object' || Array.isArray(rawSprints)) {
    throw new AppError('VALIDATION_FAILED', 'The bundle sprints must be an object.');
  }
  // Bundles carry bare entry maps without a version; infer the era from the entry
  // shape (v3 entries have a `teams` map) — an empty map is trivially current.
  const entries = Object.values(rawSprints as Record<string, unknown>);
  const looksV3 =
    entries.length === 0 ||
    entries.every((e) => e !== null && typeof e === 'object' && 'teams' in e);
  const sprintDoc = normalizeSprintData({ version: looksV3 ? 3 : 2, sprints: rawSprints });
  if (sprintDoc === null) {
    throw new AppError('VALIDATION_FAILED', 'The bundle sprints are not a supported document.');
  }

  const sprintCount = Object.keys(sprintDoc.sprints).length;
  if (body.dryRun) {
    return { applied: false, sprintCount, configured: configDoc !== null };
  }
  if (configDoc) {
    saveConfigDocument(ctx.project, {
      version: 3,
      revision: (doc?.revision ?? 0) + 1,
      config: configDoc.config,
    });
  }
  saveSprintData(ctx.project, sprintDoc);
  return { applied: true, sprintCount, configured: configDoc !== null };
}

export function getDiagnostics(ctx: RequestContext, correlationId: string): DiagnosticsResponse {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx);
  if (!canReadDiagnostics(principal)) throw forbidden('Only managers can read diagnostics.');
  const sprints = loadSprintData(ctx.project).sprints;
  return {
    correlationId,
    configured: doc !== null,
    configRevision: doc?.revision ?? 0,
    managedSprintCount: Object.keys(sprints).length,
    sprints: Object.entries(sprints)
      .map(([id, e]) => ({
        id,
        name: e.name,
        sequence: e.sequence,
        teams: Object.entries(e.teams).map(([teamId, t]) => ({
          teamId,
          capacityRevision: t.capacityRevision,
        })),
      }))
      .sort((a, b) => a.sequence - b.sequence),
  };
}
