import { describe, it, expect } from 'vitest';
import {
  getDiagnostics,
  getExport,
  getSprintData,
  postImport,
  registerSprint,
} from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { ctxFor, LEADER, MANAGER, MEMBER, seedWorld, type World } from './setup.js';

const SPRINT = { id: '207-1', name: 'AppGlass 2026-S1', start: '2026-01-05', finish: '2026-01-18' };

function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

describe('getExport', () => {
  it('returns the config + all sprint entries for a manager', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    expect(bundle.config?.boardId).toBe('board-1');
    expect(bundle.configRevision).toBe(1);
    expect(Object.keys(bundle.sprints)).toEqual([SPRINT.id]);
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
  });

  it('applies config + sprints on a real import', () => {
    const world = setup();
    const bundle = getExport(ctxFor(world, MANAGER.login));
    const target = seedWorld({ configured: false });
    const result = postImport(ctxFor(target, LEADER.login), { bundle, dryRun: false });
    expect(result.applied).toBe(true);
    const restored = getSprintData(ctxFor(target, LEADER.login)).sprints;
    expect(Object.keys(restored)).toEqual([SPRINT.id]);
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
  it('summarises managed sprints for a manager', () => {
    const world = setup();
    const diag = getDiagnostics(ctxFor(world, MANAGER.login), 'cid-test');
    expect(diag.correlationId).toBe('cid-test');
    expect(diag.configured).toBe(true);
    expect(diag.managedSprintCount).toBe(1);
    expect(diag.sprints[0]).toMatchObject({ id: SPRINT.id, sequence: 1, capacityRevision: 1 });
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
