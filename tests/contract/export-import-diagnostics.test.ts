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
import { ctxFor, LEADER, MANAGER, MEMBER, seedWorld, TEAM_ID, type World } from './setup.js';

const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };

function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
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

describe('getExport', () => {
  it('returns the v3 config + v3 (teams) sprint entries for a manager', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    expect(bundle.config?.version).toBe(3);
    expect(bundle.config?.boardId).toBe('board-1');
    expect(bundle.config?.teams.map((t) => t.id)).toEqual([TEAM_ID]);
    expect(bundle.configRevision).toBe(1);
    expect(Object.keys(bundle.sprints)).toEqual([SPRINT.id]);
    expect(Object.keys(bundle.sprints[SPRINT.id]!.teams)).toEqual([TEAM_ID]);
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
    expect(getSprintData(ctxFor(target, LEADER.login)).sprints).toEqual({});
    expect(getConfig(ctxFor(target, LEADER.login)).configured).toBe(false);
  });

  it('applies a current (v3) bundle as-is on a real import', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), { bundle, dryRun: false });
    expect(result.applied).toBe(true);
    const restored = getSprintData(ctxFor(target, LEADER.login)).sprints;
    expect(restored).toEqual(bundle.sprints);
    expect(getConfig(ctxFor(target, LEADER.login)).config).toEqual(bundle.config);
  });

  it('migrates a v2-era (pre-teams) bundle on import: config gains team-1, entries move under it', () => {
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), {
      bundle: v2EraBundle(),
      dryRun: false,
    });
    expect(result).toEqual({ applied: true, sprintCount: 1, configured: true });

    const config = getConfig(ctxFor(target, LEADER.login)).config!;
    expect(config.version).toBe(3);
    expect(config.teams).toEqual([
      {
        id: TEAM_ID,
        name: 'Team 1',
        participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
      },
    ]);
    expect(config.nameTemplate).toBe('Sprint {sequence}'); // legacy default rewritten
    expect(Object.keys(config)).not.toContain('managersGroup'); // permission scheme removed

    const entry = getSprintData(ctxFor(target, LEADER.login)).sprints[SPRINT.id]!;
    expect(entry.sequence).toBe(1);
    expect(Object.keys(entry.teams)).toEqual([TEAM_ID]);
    const team = entry.teams[TEAM_ID]!;
    expect(team.capacityRevision).toBe(2);
    expect(team.focusFactor).toBe(0.7);
    expect(team.focusFactorSource).toBe('calculated');
    expect(team.capacity.rows[MEMBER.login]!.availableMinutes).toBe(3000);
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

  it('rejects malformed bundle sprints with VALIDATION_FAILED', () => {
    const target = seedWorld({ configured: false });
    const bundle = { ...v2EraBundle(), sprints: ['not', 'a', 'map'] as unknown };
    try {
      postImport(ctxFor(target, LEADER.login), { bundle, dryRun: true });
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
  it('summarises managed sprints with per-team capacity revisions for a manager', () => {
    const world = setup();
    const diag = getDiagnostics(ctxFor(world, MANAGER.login), 'cid-test');
    expect(diag.correlationId).toBe('cid-test');
    expect(diag.configured).toBe(true);
    expect(diag.managedSprintCount).toBe(1);
    expect(diag.sprints[0]).toEqual({
      id: SPRINT.id,
      name: SPRINT.name,
      sequence: 1,
      teams: [{ teamId: TEAM_ID, capacityRevision: 1 }],
    });
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

  it('exports a null config from an unconfigured project for the leader', () => {
    const world = seedWorld({ configured: false });
    // The project leader is a manager even before any config exists (bootstrap path).
    const bundle = getExport(ctxFor(world, LEADER.login));
    expect(bundle.config).toBeNull();
    expect(bundle.sprints).toEqual({});
  });
});
