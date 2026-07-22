import { describe, it, expect } from 'vitest';
import {
  getConfig,
  getDiagnostics,
  getExport,
  getSprintData,
  postImport,
  registerSprint,
} from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import {
  BOARD_ID,
  ctxFor,
  defaultConfig,
  defaultTeam,
  LEADER,
  MANAGER,
  MEMBER,
  MEMBER_2,
  seedWorld,
  TEAM_2_ID,
  TEAM_ID,
  type World,
} from './setup.js';

const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };
const SPRINT_2 = { id: '207-2', name: 'Sprint 2', start: '2026-01-19', finish: '2026-02-01' };

function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

/**
 * Two teams sharing ONE board: Alpha manages Sprint 1, Beta manages Sprint 1 AND
 * Sprint 2 — the same native Sprint id appears under two teams, so distinct-id
 * counting is observable.
 */
function twoTeamsSharedBoardWorld(): World {
  const world = seedWorld({
    config: defaultConfig({
      teams: [
        defaultTeam({
          name: 'Alpha',
          participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
        }),
        defaultTeam({
          id: TEAM_2_ID,
          name: 'Beta',
          participants: [{ userId: MEMBER_2.login, enabled: true, allocation: 1 }],
        }),
      ],
    }),
  });
  const ctx = ctxFor(world, MANAGER.login);
  registerSprint(ctx, { teamId: TEAM_ID, sprint: SPRINT });
  registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT });
  registerSprint(ctx, { teamId: TEAM_2_ID, sprint: SPRINT_2 });
  return world;
}

/** A pre-teams (v0.2.0-era) export: v2 config with `participants`, flat sprint entries. */
function v2EraBundle() {
  return {
    exportedAt: Date.UTC(2026, 0, 1),
    configRevision: 3,
    config: {
      version: 2,
      boardId: 'board-1',
      originalEffortField: 'Original estimation',
      currentEffortField: 'Estimation',
      hoursPerDay: 8,
      sprintLengthDays: 14,
      datePolicy: 'continuous',
      nameTemplate: 'AppGlass {year}-S{sequence}',
      backlogQuery: '',
      learningRate: 0.5,
      // v2-era field for the removed custom permission scheme; import must strip it.
      managersGroup: 'Capacity Managers',
      participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
    },
    sprints: {
      [SPRINT.id]: {
        sequence: 1,
        name: SPRINT.name,
        start: SPRINT.start,
        finish: SPRINT.finish,
        capacityRevision: 2,
        capacity: {
          version: 2,
          createdFromConfigVersion: 1,
          rows: {
            [MEMBER.login]: {
              userId: MEMBER.login,
              displayNameSnapshot: MEMBER.name,
              defaultMinutes: 4800,
              availableMinutes: 3000,
              availableWasCustomized: true,
              note: 'PTO',
              updatedAt: 5,
              updatedBy: MEMBER.login,
            },
          },
        },
        focusFactor: 0.7,
        focusFactorSource: 'calculated',
        focusFactorOverride: null,
        excludedFromCalibration: false,
        calibrationSkipReason: null,
        createdAt: 1,
        updatedAt: 5,
      },
    },
  };
}

const ALPHA_CAPACITY = makeDoc([
  makeRow({
    userId: MEMBER.login,
    displayNameSnapshot: MEMBER.name,
    availableMinutes: 3000,
    availableWasCustomized: true,
    note: 'PTO',
    updatedAt: 5,
    updatedBy: MEMBER.login,
  }),
]);
const BETA_CAPACITY = makeDoc([
  makeRow({ userId: MEMBER_2.login, displayNameSnapshot: MEMBER_2.name }),
]);

/**
 * A v0.3-era export: v3 config with SHARED project-level settings plus two teams
 * (Beta carrying a non-empty backlogQuery override), sprint entries keyed
 * sprint-first with a per-entry `teams` map.
 */
function v3EraBundle() {
  return {
    exportedAt: Date.UTC(2026, 0, 1),
    configRevision: 3,
    config: {
      version: 3,
      boardId: 'board-1',
      originalEffortField: 'Original estimation',
      currentEffortField: 'Estimation',
      hoursPerDay: 8,
      sprintLengthDays: 14,
      datePolicy: 'continuous',
      nameTemplate: 'Sprint {sequence}',
      backlogQuery: 'project: AGP',
      learningRate: 0.5,
      reminderLeadDays: 3,
      teams: [
        {
          id: TEAM_ID,
          name: 'Alpha',
          participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
        },
        {
          id: TEAM_2_ID,
          name: 'Beta',
          participants: [{ userId: MEMBER_2.login, enabled: true, allocation: 1 }],
          backlogQuery: '#Beta',
        },
      ],
    },
    sprints: {
      [SPRINT.id]: {
        sequence: 1,
        name: SPRINT.name,
        start: SPRINT.start,
        finish: SPRINT.finish,
        createdAt: 1,
        updatedAt: 5,
        teams: {
          [TEAM_ID]: {
            capacityRevision: 2,
            capacity: ALPHA_CAPACITY,
            focusFactor: 0.7,
            focusFactorSource: 'calculated',
            focusFactorOverride: null,
            excludedFromCalibration: false,
            calibrationSkipReason: null,
          },
          [TEAM_2_ID]: {
            capacityRevision: 1,
            capacity: BETA_CAPACITY,
            focusFactor: 0.75,
            focusFactorSource: 'bootstrap',
            focusFactorOverride: null,
            excludedFromCalibration: false,
            calibrationSkipReason: null,
          },
        },
      },
    },
  };
}

describe('getExport', () => {
  it('returns the v4 config + per-team sprint maps for a manager', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    expect(bundle.config?.version).toBe(4);
    // Since v4 every planning setting lives ON the team, not at project level.
    expect(bundle.config?.teams.map((t) => t.id)).toEqual([TEAM_ID]);
    expect(bundle.config?.teams[0]?.boardId).toBe(BOARD_ID);
    expect(bundle.configRevision).toBe(1);
    expect(Object.keys(bundle.teams)).toEqual([TEAM_ID]);
    expect(Object.keys(bundle.teams[TEAM_ID]!.sprints)).toEqual([SPRINT.id]);
  });

  it('exports every team’s own sprint map when several teams manage sprints', () => {
    const world = twoTeamsSharedBoardWorld();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    expect(Object.keys(bundle.teams).sort()).toEqual([TEAM_ID, TEAM_2_ID]);
    expect(Object.keys(bundle.teams[TEAM_ID]!.sprints)).toEqual([SPRINT.id]);
    expect(Object.keys(bundle.teams[TEAM_2_ID]!.sprints).sort()).toEqual([
      SPRINT.id,
      SPRINT_2.id,
    ]);
  });

  it('forbids a non-manager', () => {
    const world = setup();
    try {
      getExport(ctxFor(world, MEMBER.login));
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });
});

describe('postImport', () => {
  it('dry-run reports counts without applying', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    // Import into a fresh, unconfigured project — the leader bootstraps it.
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), { bundle, dryRun: true });
    expect(result).toEqual({ applied: false, sprintCount: 1, configured: true });
    expect(target.project.getProperty('scpSprintDataJson')).toBeNull();
    expect(getConfig(ctxFor(target, LEADER.login)).configured).toBe(false);
  });

  it('counts DISTINCT native sprint ids across teams (a shared sprint counts once)', () => {
    const world = twoTeamsSharedBoardWorld();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), { bundle, dryRun: true });
    // Three team entries over 207-1/207-2, but only two distinct native Sprints.
    expect(result).toEqual({ applied: false, sprintCount: 2, configured: true });
  });

  it('applies a current (v4) bundle as-is on a real import', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), { bundle, dryRun: false });
    expect(result.applied).toBe(true);
    const restored = getSprintData(ctxFor(target, LEADER.login), TEAM_ID).sprints;
    expect(restored).toEqual(bundle.teams[TEAM_ID]!.sprints);
    expect(getConfig(ctxFor(target, LEADER.login)).config).toEqual(bundle.config);
  });

  it('migrates a v3-era bundle: shared settings move into each team, entries re-key team-first', () => {
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), {
      bundle: v3EraBundle(),
      dryRun: false,
    });
    // Two team entries, one distinct native Sprint.
    expect(result).toEqual({ applied: true, sprintCount: 1, configured: true });

    const config = getConfig(ctxFor(target, LEADER.login)).config!;
    expect(config.version).toBe(4);
    expect(Object.keys(config).sort()).toEqual(['teams', 'version']); // nothing project-level survives
    const [alpha, beta] = config.teams;
    expect(alpha).toMatchObject({
      id: TEAM_ID,
      name: 'Alpha',
      boardId: 'board-1',
      originalEffortField: 'Original estimation',
      currentEffortField: 'Estimation',
      hoursPerDay: 8,
      sprintLengthDays: 14,
      datePolicy: 'continuous',
      nameTemplate: 'Sprint {sequence}',
      backlogQuery: 'project: AGP', // no override — the project-level query moves in
      learningRate: 0.5,
      reminderLeadDays: 3,
    });
    // Beta's own non-empty backlogQuery override WINS over the project query.
    expect(beta).toMatchObject({ id: TEAM_2_ID, backlogQuery: '#Beta', reminderLeadDays: 3 });

    const shared = {
      sequence: 1,
      name: SPRINT.name,
      start: SPRINT.start,
      finish: SPRINT.finish,
      createdAt: 1,
      updatedAt: 5,
    };
    expect(getSprintData(ctxFor(target, LEADER.login), TEAM_ID).sprints).toEqual({
      [SPRINT.id]: {
        ...shared,
        capacityRevision: 2,
        capacity: ALPHA_CAPACITY,
        focusFactor: 0.7,
        focusFactorSource: 'calculated',
        focusFactorOverride: null,
        excludedFromCalibration: false,
        calibrationSkipReason: null,
      },
    });
    expect(getSprintData(ctxFor(target, LEADER.login), TEAM_2_ID).sprints).toEqual({
      [SPRINT.id]: {
        ...shared,
        capacityRevision: 1,
        capacity: BETA_CAPACITY,
        focusFactor: 0.75,
        focusFactorSource: 'bootstrap',
        focusFactorOverride: null,
        excludedFromCalibration: false,
        calibrationSkipReason: null,
      },
    });
  });

  it('migrates a v2-era (pre-teams) bundle on import: settings fold into team-1, entries move under it', () => {
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), {
      bundle: v2EraBundle(),
      dryRun: false,
    });
    expect(result).toEqual({ applied: true, sprintCount: 1, configured: true });

    const config = getConfig(ctxFor(target, LEADER.login)).config!;
    expect(config.version).toBe(4);
    expect(Object.keys(config)).not.toContain('managersGroup'); // permission scheme removed
    expect(config.teams).toEqual([
      {
        id: TEAM_ID,
        name: 'Team 1',
        participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
        boardId: 'board-1',
        originalEffortField: 'Original estimation',
        currentEffortField: 'Estimation',
        hoursPerDay: 8,
        sprintLengthDays: 14,
        datePolicy: 'continuous',
        nameTemplate: 'Sprint {sequence}', // legacy default rewritten
        backlogQuery: '',
        learningRate: 0.5,
      },
    ]);

    const entry = getSprintData(ctxFor(target, LEADER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(entry.sequence).toBe(1);
    expect(entry.name).toBe(SPRINT.name);
    expect(entry.capacityRevision).toBe(2);
    expect(entry.focusFactor).toBe(0.7);
    expect(entry.focusFactorSource).toBe('calculated');
    expect(entry.capacity.rows[MEMBER.login]!.availableMinutes).toBe(3000);
  });

  it('rejects a malformed bundle config with VALIDATION_FAILED', () => {
    const target = seedWorld({ configured: false });
    const bundle = v2EraBundle();
    (bundle.config as Record<string, unknown>)['boardId'] = 42;
    try {
      postImport(ctxFor(target, LEADER.login), { bundle, dryRun: true });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects malformed legacy bundle sprints with VALIDATION_FAILED', () => {
    const target = seedWorld({ configured: false });
    const bundle = { ...v2EraBundle(), sprints: ['not', 'a', 'map'] as unknown };
    try {
      postImport(ctxFor(target, LEADER.login), { bundle, dryRun: true });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects a malformed v4 teams map with VALIDATION_FAILED', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    const target = seedWorld({ configured: false });
    try {
      postImport(ctxFor(target, LEADER.login), {
        bundle: { ...bundle, teams: ['not', 'a', 'map'] as unknown },
        dryRun: true,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('forbids a non-manager', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    try {
      postImport(ctxFor(world, MEMBER.login), { bundle, dryRun: true });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });
});

describe('getDiagnostics', () => {
  it('summarises the team’s managed sprints with capacity revisions for a manager', () => {
    const world = setup();
    const diag = getDiagnostics(ctxFor(world, MANAGER.login), 'cid-test');
    expect(diag.correlationId).toBe('cid-test');
    expect(diag.configured).toBe(true);
    expect(diag.configRevision).toBe(1);
    expect(diag.managedSprintCount).toBe(1);
    expect(diag.teams).toEqual([
      {
        teamId: TEAM_ID,
        sprints: [{ id: SPRINT.id, name: SPRINT.name, sequence: 1, capacityRevision: 1 }],
      },
    ]);
  });

  it('reports per-team sprint lists and counts distinct sprint ids across teams', () => {
    const world = twoTeamsSharedBoardWorld();
    const diag = getDiagnostics(ctxFor(world, MANAGER.login), 'cid-2');
    // 207-1 is managed by BOTH teams; only distinct native ids are counted.
    expect(diag.managedSprintCount).toBe(2);
    expect(diag.teams).toEqual([
      {
        teamId: TEAM_ID,
        sprints: [{ id: SPRINT.id, name: SPRINT.name, sequence: 1, capacityRevision: 1 }],
      },
      {
        teamId: TEAM_2_ID,
        sprints: [
          { id: SPRINT.id, name: SPRINT.name, sequence: 1, capacityRevision: 1 },
          { id: SPRINT_2.id, name: SPRINT_2.name, sequence: 2, capacityRevision: 1 },
        ],
      },
    ]);
  });

  it('forbids a non-manager', () => {
    const world = setup();
    try {
      getDiagnostics(ctxFor(world, MEMBER.login), 'cid-test');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('exports a null config and empty teams from an unconfigured project for the leader', () => {
    const world = seedWorld({ configured: false });
    // The project leader is a manager even before any config exists (bootstrap path).
    const bundle = getExport(ctxFor(world, LEADER.login));
    expect(bundle.config).toBeNull();
    expect(bundle.teams).toEqual({});
  });
});
