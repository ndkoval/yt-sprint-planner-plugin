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
 * Team scoping (config v4): every team owns its whole configuration AND its own
 * Sprint map (`data.teams[teamId].sprints[sprintId]`) — teams may plan on different
 * boards with different cadences, so nothing is shared between them. A team-scoped
 * request resolves its target team from the config — an explicit `teamId`, or the
 * config's ONLY team when omitted (ambiguous with several teams → VALIDATION_FAILED).
 * A Sprint is "managed" PER TEAM: writes against a Sprint the team never registered
 * fail with NOT_FOUND (the planner registers Sprints it creates). Entries of teams
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
import type { CapacityRow, ProjectConfig, Team, TeamSprint } from '../shared/types.js';
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

/** The team's entry for a Sprint; NOT_FOUND when the team never registered it. */
function requireTeamSprint(ctx: RequestContext, teamId: string, sprintId: string): TeamSprint {
  const entry = loadSprintData(ctx.project).teams[teamId]?.sprints[sprintId];
  if (!entry) throw notFound(`Sprint ${sprintId} (team ${teamId})`);
  return entry;
}

function saveTeamSprint(
  ctx: RequestContext,
  teamId: string,
  sprintId: string,
  entry: TeamSprint,
): TeamSprint {
  const data = loadSprintData(ctx.project);
  const teamSprints = data.teams[teamId] ?? { sprints: {} };
  teamSprints.sprints[sprintId] = entry;
  data.teams[teamId] = teamSprints;
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
  saveConfigDocument(ctx.project, { version: 4, revision: newRevision, config: body.config });
  // Roster changes take effect IMMEDIATELY: capacity rows for participants who
  // joined a team are backfilled across the team's managed Sprints — so new
  // members show up on the planner right after saving, not only after the next
  // sprint-register. (A brand-new team has no Sprints yet — it registers its own.)
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
 * Backfill every team's managed Sprints against the CURRENT config: enabled
 * participants missing a row are added (revision bumps per changed Sprint).
 * Existing rows, removed teams' entries and everything the user customized stay
 * untouched.
 */
function reconcileSprintsWithConfig(ctx: RequestContext, config: ProjectConfig): void {
  const data = loadSprintData(ctx.project);
  const now = ctx.env.now();
  let anyChanged = false;
  for (const team of config.teams) {
    const teamSprints = data.teams[team.id];
    if (!teamSprints) continue;
    for (const [sprintId, entry] of Object.entries(teamSprints.sprints)) {
      const seeded = seedCapacityDocument(
        team,
        team.hoursPerDay,
        participantNames(ctx, team),
        entry.start,
        entry.finish,
        now,
      );
      const rows: Record<string, CapacityRow> = { ...entry.capacity.rows };
      let rowsAdded = false;
      for (const [login, row] of Object.entries(seeded.rows)) {
        if (!(login in rows)) {
          rows[login] = row;
          rowsAdded = true;
        }
      }
      if (rowsAdded) {
        teamSprints.sprints[sprintId] = {
          ...entry,
          capacity: { ...entry.capacity, rows },
          capacityRevision: entry.capacityRevision + 1,
          updatedAt: now,
        };
        anyChanged = true;
      }
    }
  }
  if (anyChanged) saveSprintData(ctx.project, data);
}

// ---------------------------------------------------------------------------
// Sprint app-state
// ---------------------------------------------------------------------------

export function getSprintData(ctx: RequestContext, teamId: string | undefined): SprintDataResponse {
  const { config } = requireConfig(ctx);
  const team = requireTeam(config, teamId);
  return { sprints: loadSprintData(ctx.project).teams[team.id]?.sprints ?? {} };
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

/**
 * Upsert one TEAM's app state for a native Sprint on the team's board. A new entry
 * gets the team's next sequence and a seeded capacity document; an existing entry
 * refreshes its name/date snapshots — when dates change, non-customized rows track
 * the recomputed default. Enabled participants missing a row are added on every
 * call, so roster changes propagate.
 */
export function registerSprint(
  ctx: RequestContext,
  body: RegisterSprintRequest,
): { sprintId: string; teamId: string; entry: TeamSprint } {
  const { config, principal } = requireConfig(ctx);
  if (!canCreateSprint(principal)) throw forbidden('Only managers can plan Sprints.');
  if (body.sprint.finish <= body.sprint.start) {
    throw new AppError('VALIDATION_FAILED', 'Finish must be after start.');
  }
  const team = requireTeam(config, body.teamId);

  const now = ctx.env.now();
  const data = loadSprintData(ctx.project);
  const teamSprints = data.teams[team.id] ?? { sprints: {} };
  const existing = teamSprints.sprints[body.sprint.id];

  let entry: TeamSprint;
  if (!existing) {
    entry = {
      sequence: nextSequence(Object.values(teamSprints.sprints).map((e) => e.sequence)),
      name: body.sprint.name,
      start: body.sprint.start,
      finish: body.sprint.finish,
      capacityRevision: 1,
      capacity: seedCapacityDocument(
        team,
        team.hoursPerDay,
        participantNames(ctx, team),
        body.sprint.start,
        body.sprint.finish,
        now,
      ),
      focusFactor: body.seed?.focusFactor ?? DEFAULT_FOCUS_FACTOR,
      focusFactorSource: body.seed?.focusFactorSource ?? 'bootstrap',
      focusFactorOverride: null,
      excludedFromCalibration: false,
      calibrationSkipReason: null,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const datesChanged =
      existing.start !== body.sprint.start || existing.finish !== body.sprint.finish;
    let capacity = existing.capacity;
    if (datesChanged) {
      capacity = reapplyDefaults(
        capacity,
        body.sprint.start,
        body.sprint.finish,
        team.hoursPerDay,
        allocationByUser(team),
      );
    }
    // Add rows for enabled participants that joined the team after seeding.
    const seeded = seedCapacityDocument(
      team,
      team.hoursPerDay,
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
    entry = {
      ...existing,
      name: body.sprint.name,
      start: body.sprint.start,
      finish: body.sprint.finish,
      capacity: { ...capacity, rows },
      capacityRevision: capacityChanged
        ? existing.capacityRevision + 1
        : existing.capacityRevision,
      updatedAt: now,
    };
  }

  teamSprints.sprints[body.sprint.id] = entry;
  data.teams[team.id] = teamSprints;
  saveSprintData(ctx.project, data);
  return { sprintId: body.sprint.id, teamId: team.id, entry };
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export function writeCapacity(
  ctx: RequestContext,
  body: CapacityWriteRequest,
): { sprintId: string; teamId: string; entry: TeamSprint } {
  const { config, principal } = requireConfig(ctx);
  const team = requireTeam(config, body.teamId);
  const target = body.target === 'me' ? ctx.user.login : body.target.userId;
  if (!canEditCapacityRow(principal, { targetUserId: target })) {
    throw forbidden('You can only edit your own availability.');
  }
  const entry = requireTeamSprint(ctx, team.id, body.sprintId);
  if (body.expectedRevision !== entry.capacityRevision) throw capacityConflict();

  let row = entry.capacity.rows[target];
  if (!row) {
    // A participant added to the team after this Sprint was seeded gets a row on
    // their first edit; non-members of THIS team have no capacity here.
    const participant = team.participants.find((p) => p.enabled && p.userId === target);
    if (!participant) throw notFound(`Capacity row for user ${target} in team ${team.name}`);
    const seeded = seedCapacityDocument(
      team,
      team.hoursPerDay,
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

  const next: TeamSprint = {
    ...entry,
    capacity: { ...entry.capacity, rows: { ...entry.capacity.rows, [target]: updated } },
    capacityRevision: entry.capacityRevision + 1,
    updatedAt: now,
  };
  return {
    sprintId: body.sprintId,
    teamId: team.id,
    entry: saveTeamSprint(ctx, team.id, body.sprintId, next),
  };
}

export function resetCapacity(
  ctx: RequestContext,
  body: CapacityResetRequest,
): { sprintId: string; teamId: string; entry: TeamSprint } {
  const { config, principal } = requireConfig(ctx);
  const team = requireTeam(config, body.teamId);
  if (!canEditCapacityRow(principal, { targetUserId: body.userId })) {
    throw forbidden('You can only reset your own availability.');
  }
  const entry = requireTeamSprint(ctx, team.id, body.sprintId);
  if (body.expectedRevision !== entry.capacityRevision) throw capacityConflict();
  const row = entry.capacity.rows[body.userId];
  if (!row) throw notFound(`Capacity row for user ${body.userId}`);

  const now = ctx.env.now();
  const updated: CapacityRow = {
    ...row,
    availableMinutes: row.defaultMinutes,
    availableWasCustomized: false,
    updatedAt: now,
    updatedBy: ctx.user.login,
  };
  const next: TeamSprint = {
    ...entry,
    capacity: { ...entry.capacity, rows: { ...entry.capacity.rows, [body.userId]: updated } },
    capacityRevision: entry.capacityRevision + 1,
    updatedAt: now,
  };
  return {
    sprintId: body.sprintId,
    teamId: team.id,
    entry: saveTeamSprint(ctx, team.id, body.sprintId, next),
  };
}

// ---------------------------------------------------------------------------
// Focus factor & calibration
// ---------------------------------------------------------------------------

export function overrideFocusFactor(
  ctx: RequestContext,
  body: OverrideFocusFactorRequest,
): { sprintId: string; teamId: string; entry: TeamSprint } {
  const { config, principal } = requireConfig(ctx);
  if (!canOverrideFocusFactor(principal)) throw forbidden('Only managers can override.');
  const team = requireTeam(config, body.teamId);
  const entry = requireTeamSprint(ctx, team.id, body.sprintId);
  const now = ctx.env.now();
  const next: TeamSprint = {
    ...entry,
    focusFactor: body.newValue,
    focusFactorSource: 'manual',
    focusFactorOverride: {
      reason: body.reason,
      oldValue: entry.focusFactor,
      newValue: body.newValue,
      userId: ctx.user.login,
      timestamp: now,
    },
    updatedAt: now,
  };
  return {
    sprintId: body.sprintId,
    teamId: team.id,
    entry: saveTeamSprint(ctx, team.id, body.sprintId, next),
  };
}

export function setCalibration(
  ctx: RequestContext,
  body: SetCalibrationRequest,
): { sprintId: string; teamId: string; entry: TeamSprint } {
  const { config, principal } = requireConfig(ctx);
  if (!canChangeCalibration(principal)) throw forbidden('Only managers can change calibration.');
  const team = requireTeam(config, body.teamId);
  const entry = requireTeamSprint(ctx, team.id, body.sprintId);
  const now = ctx.env.now();
  const next: TeamSprint = {
    ...entry,
    excludedFromCalibration: body.excluded,
    calibrationSkipReason: body.excluded ? (body.reason ?? '') : null,
    updatedAt: now,
  };
  return {
    sprintId: body.sprintId,
    teamId: team.id,
    entry: saveTeamSprint(ctx, team.id, body.sprintId, next),
  };
}

// ---------------------------------------------------------------------------
// Per-user preferences (no project scope — see UserPrefs in shared/api.ts)
// ---------------------------------------------------------------------------

const PREFS_PROP = 'scpPrefsJson';

export function getPrefs(user: BackendUser): UserPrefs {
  const raw = user.getProperty(PREFS_PROP);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as { lastProjectKey?: unknown; lastTeamByProject?: unknown };
    const prefs: UserPrefs = {};
    if (typeof parsed.lastProjectKey === 'string') prefs.lastProjectKey = parsed.lastProjectKey;
    if (
      parsed.lastTeamByProject !== null &&
      typeof parsed.lastTeamByProject === 'object' &&
      !Array.isArray(parsed.lastTeamByProject)
    ) {
      const map: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.lastTeamByProject as object)) {
        if (typeof value === 'string') map[key] = value;
      }
      if (Object.keys(map).length > 0) prefs.lastTeamByProject = map;
    }
    return prefs;
  } catch {
    return {};
  }
}

/** Merge-update the caller's prefs; the property is removed entirely when empty. */
export function savePrefs(user: BackendUser, body: SavePrefsRequest): UserPrefs {
  const prefs = getPrefs(user);
  if (body.lastProjectKey !== undefined) {
    if (body.lastProjectKey === null) delete prefs.lastProjectKey;
    else prefs.lastProjectKey = body.lastProjectKey;
  }
  if (body.lastTeam !== undefined) {
    const map = { ...(prefs.lastTeamByProject ?? {}) };
    if (body.lastTeam.teamId === null) delete map[body.lastTeam.projectKey];
    else map[body.lastTeam.projectKey] = body.lastTeam.teamId;
    if (Object.keys(map).length > 0) prefs.lastTeamByProject = map;
    else delete prefs.lastTeamByProject;
  }
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
    teams: loadSprintData(ctx.project).teams,
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

  // v4 bundles carry `teams` (per-team Sprint maps); older exports carry `sprints`
  // (bare entry maps without a version — v3 entries hold a `teams` map, v2 entries
  // are flat). Wrap accordingly and let the shared migration chain lift everything
  // to the current version.
  const rawTeams = body.bundle.teams;
  const rawSprints = body.bundle.sprints;
  let wrapped: Record<string, unknown>;
  if (rawTeams !== undefined && rawTeams !== null) {
    if (typeof rawTeams !== 'object' || Array.isArray(rawTeams)) {
      throw new AppError('VALIDATION_FAILED', 'The bundle teams must be an object.');
    }
    wrapped = { version: 4, teams: rawTeams };
  } else {
    if (rawSprints === null || rawSprints === undefined || typeof rawSprints !== 'object' || Array.isArray(rawSprints)) {
      throw new AppError('VALIDATION_FAILED', 'The bundle sprints must be an object.');
    }
    const entries = Object.values(rawSprints as Record<string, unknown>);
    const looksV3 =
      entries.length === 0 ||
      entries.every((e) => e !== null && typeof e === 'object' && 'teams' in e);
    wrapped = { version: looksV3 ? 3 : 2, sprints: rawSprints };
  }
  const sprintDoc = normalizeSprintData(wrapped);
  if (sprintDoc === null) {
    throw new AppError('VALIDATION_FAILED', 'The bundle sprints are not a supported document.');
  }

  const sprintCount = new Set(
    Object.values(sprintDoc.teams).flatMap((t) => Object.keys(t.sprints)),
  ).size;
  if (body.dryRun) {
    return { applied: false, sprintCount, configured: configDoc !== null };
  }
  if (configDoc) {
    saveConfigDocument(ctx.project, {
      version: 4,
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
  const teams = loadSprintData(ctx.project).teams;
  const sprintIds = new Set(Object.values(teams).flatMap((t) => Object.keys(t.sprints)));
  return {
    correlationId,
    configured: doc !== null,
    configRevision: doc?.revision ?? 0,
    managedSprintCount: sprintIds.size,
    teams: Object.entries(teams).map(([teamId, t]) => ({
      teamId,
      sprints: Object.entries(t.sprints)
        .map(([id, e]) => ({
          id,
          name: e.name,
          sequence: e.sequence,
          capacityRevision: e.capacityRevision,
        }))
        .sort((a, b) => a.sequence - b.sequence),
    })),
  };
}
