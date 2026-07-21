/**
 * Backend request handlers: app-owned state (config, capacity, focus factor,
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
  SetCalibrationRequest,
  SprintDataResponse,
} from '../shared/api.js';
import type { CapacityRow, ProjectConfig, SprintEntry } from '../shared/types.js';
import { AppError, capacityConflict, configConflict, forbidden, notConfigured, notFound } from './errors.js';
import type { BackendEnv, BackendProject, BackendUser } from './env.js';
import {
  loadConfigDocument,
  loadSprintData,
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
 * Resolve the caller's principal. The project leader is always a manager — this is
 * the first-run bootstrap (before a managers group is configured, someone must be
 * able to set one) and a sensible default afterwards.
 */
export function resolvePrincipal(ctx: RequestContext, config: ProjectConfig | null): Principal {
  const isLeader = ctx.project.leaderLogin !== null && ctx.project.leaderLogin === ctx.user.login;
  const inManagersGroup =
    config?.managersGroup !== undefined && ctx.user.isInGroup(config.managersGroup);
  return { userId: ctx.user.login, isManager: isLeader || inManagersGroup };
}

/** Load config + principal; throws NOT_CONFIGURED when no config exists. */
function requireConfig(ctx: RequestContext): { config: ProjectConfig; principal: Principal } {
  const doc = loadConfigDocument(ctx.project);
  if (!doc) throw notConfigured();
  return { config: doc.config, principal: resolvePrincipal(ctx, doc.config) };
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
  const principal = resolvePrincipal(ctx, doc?.config ?? null);
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
  const principal = resolvePrincipal(ctx, existing?.config ?? null);
  if (!canEditSettings(principal)) {
    throw forbidden('Only managers can change settings.');
  }
  const currentRevision = existing?.revision ?? 0;
  if (body.expectedRevision !== currentRevision) throw configConflict();
  const newRevision = currentRevision + 1;
  saveConfigDocument(ctx.project, { version: 2, revision: newRevision, config: body.config });
  return {
    configured: true,
    configRevision: newRevision,
    config: body.config,
    isManager: resolvePrincipal(ctx, body.config).isManager,
    isProjectLeader: ctx.project.leaderLogin === ctx.user.login,
    me: { login: ctx.user.login, name: ctx.user.name },
  };
}

// ---------------------------------------------------------------------------
// Sprint app-state
// ---------------------------------------------------------------------------

export function getSprintData(ctx: RequestContext): SprintDataResponse {
  return { sprints: loadSprintData(ctx.project).sprints };
}

/** Display names for the config's enabled participants (login fallback). */
function participantNames(ctx: RequestContext, config: ProjectConfig): Record<string, string> {
  const names: Record<string, string> = {};
  for (const p of config.participants) {
    if (p.enabled) names[p.userId] = ctx.env.findUserNameByLogin(p.userId) ?? p.userId;
  }
  return names;
}

function allocationByUser(config: ProjectConfig): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of config.participants) out[p.userId] = p.allocation ?? 1;
  return out;
}

/**
 * Upsert the app state for a native Sprint. New entries get a sequence and seeded
 * capacity rows; existing entries refresh their name/date snapshots — when dates
 * change, non-customized rows track the recomputed default. Enabled participants
 * missing a row are added on every call, so config team changes propagate.
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

  let entry: SprintEntry;
  if (!existing) {
    entry = {
      sequence: nextSequence(Object.values(data.sprints).map((e) => e.sequence)),
      name: body.sprint.name,
      start: body.sprint.start,
      finish: body.sprint.finish,
      capacityRevision: 1,
      capacity: seedCapacityDocument(
        config,
        participantNames(ctx, config),
        body.sprint.start,
        body.sprint.finish,
        now,
      ),
      focusFactor: body.focusFactor ?? DEFAULT_FOCUS_FACTOR,
      focusFactorSource: body.focusFactorSource ?? 'bootstrap',
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
        config.hoursPerDay,
        allocationByUser(config),
      );
    }
    // Add rows for enabled participants that joined the team after seeding.
    const seeded = seedCapacityDocument(
      config,
      participantNames(ctx, config),
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
      capacityRevision: capacityChanged ? existing.capacityRevision + 1 : existing.capacityRevision,
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

export function writeCapacity(
  ctx: RequestContext,
  body: CapacityWriteRequest,
): { sprintId: string; entry: SprintEntry } {
  const { config, principal } = requireConfig(ctx);
  const target = body.target === 'me' ? ctx.user.login : body.target.userId;
  if (!canEditCapacityRow(principal, { targetUserId: target })) {
    throw forbidden('You can only edit your own availability.');
  }
  const entry = requireEntry(ctx, body.sprintId);
  if (body.expectedRevision !== entry.capacityRevision) throw capacityConflict();

  let row = entry.capacity.rows[target];
  if (!row) {
    // A participant added to the team after this Sprint was seeded gets a row on
    // their first edit; non-participants have no capacity here.
    const participant = config.participants.find((p) => p.enabled && p.userId === target);
    if (!participant) throw notFound(`Capacity row for user ${target}`);
    const seeded = seedCapacityDocument(
      config,
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

  const next: SprintEntry = {
    ...entry,
    capacity: { ...entry.capacity, rows: { ...entry.capacity.rows, [target]: updated } },
    capacityRevision: entry.capacityRevision + 1,
    updatedAt: now,
  };
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

export function resetCapacity(
  ctx: RequestContext,
  body: CapacityResetRequest,
): { sprintId: string; entry: SprintEntry } {
  const { principal } = requireConfig(ctx);
  if (!canEditCapacityRow(principal, { targetUserId: body.userId })) {
    throw forbidden('You can only reset your own availability.');
  }
  const entry = requireEntry(ctx, body.sprintId);
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
  const next: SprintEntry = {
    ...entry,
    capacity: { ...entry.capacity, rows: { ...entry.capacity.rows, [body.userId]: updated } },
    capacityRevision: entry.capacityRevision + 1,
    updatedAt: now,
  };
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

// ---------------------------------------------------------------------------
// Focus factor & calibration
// ---------------------------------------------------------------------------

export function overrideFocusFactor(
  ctx: RequestContext,
  body: OverrideFocusFactorRequest,
): { sprintId: string; entry: SprintEntry } {
  const { principal } = requireConfig(ctx);
  if (!canOverrideFocusFactor(principal)) throw forbidden('Only managers can override.');
  const entry = requireEntry(ctx, body.sprintId);
  const now = ctx.env.now();
  const next: SprintEntry = {
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
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

export function setCalibration(
  ctx: RequestContext,
  body: SetCalibrationRequest,
): { sprintId: string; entry: SprintEntry } {
  const { principal } = requireConfig(ctx);
  if (!canChangeCalibration(principal)) throw forbidden('Only managers can change calibration.');
  const entry = requireEntry(ctx, body.sprintId);
  const next: SprintEntry = {
    ...entry,
    excludedFromCalibration: body.excluded,
    calibrationSkipReason: body.excluded ? (body.reason ?? '') : null,
    updatedAt: ctx.env.now(),
  };
  return { sprintId: body.sprintId, entry: saveEntry(ctx, body.sprintId, next) };
}

// ---------------------------------------------------------------------------
// Export / import / diagnostics
// ---------------------------------------------------------------------------

export function getExport(ctx: RequestContext): ExportBundle {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx, doc?.config ?? null);
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
  const principal = resolvePrincipal(ctx, doc?.config ?? null);
  if (!canImportExport(principal)) throw forbidden('Only managers can import.');
  const sprintCount = Object.keys(body.bundle.sprints).length;
  if (body.dryRun) {
    return { applied: false, sprintCount, configured: body.bundle.config !== null };
  }
  if (body.bundle.config) {
    saveConfigDocument(ctx.project, {
      version: 2,
      revision: (doc?.revision ?? 0) + 1,
      config: body.bundle.config,
    });
  }
  saveSprintData(ctx.project, { version: 2, sprints: body.bundle.sprints });
  return { applied: true, sprintCount, configured: body.bundle.config !== null };
}

export function getDiagnostics(ctx: RequestContext, correlationId: string): DiagnosticsResponse {
  const doc = loadConfigDocument(ctx.project);
  const principal = resolvePrincipal(ctx, doc?.config ?? null);
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
        capacityRevision: e.capacityRevision,
      }))
      .sort((a, b) => a.sequence - b.sequence),
  };
}
