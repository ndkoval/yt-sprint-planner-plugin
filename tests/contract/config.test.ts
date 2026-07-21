import { describe, it, expect } from 'vitest';
import { getConfig, putConfig } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { ctxFor, defaultConfig, LEADER, MANAGER, MEMBER, seedWorld } from './setup.js';

describe('getConfig', () => {
  it('reports unconfigured when no config is stored', () => {
    const world = seedWorld({ configured: false });
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.configured).toBe(false);
    expect(res.config).toBeNull();
    expect(res.isManager).toBe(false);
  });

  it('returns config and isManager=true for a managers-group member', () => {
    const world = seedWorld();
    const res = getConfig(ctxFor(world, MANAGER.login));
    expect(res.configured).toBe(true);
    expect(res.config?.boardId).toBe('board-1');
    expect(res.configRevision).toBe(1);
    expect(res.isManager).toBe(true);
  });

  it('treats the project leader as a manager and flags isProjectLeader', () => {
    const world = seedWorld();
    const res = getConfig(ctxFor(world, LEADER.login));
    expect(res.isManager).toBe(true);
    expect(res.isProjectLeader).toBe(true);
  });

  it('returns isManager=false for a plain member', () => {
    const world = seedWorld();
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.isManager).toBe(false);
    expect(res.isProjectLeader).toBe(false);
    expect(res.me).toEqual({ login: MEMBER.login, name: MEMBER.name });
  });

  it('treats malformed persisted config JSON as unconfigured', () => {
    const world = seedWorld({ configured: false });
    world.project.setProperty('scpConfigJson', '{ not valid json');
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.configured).toBe(false);
    expect(res.config).toBeNull();
  });

  it('treats a v1 (pre-release) config document as unconfigured', () => {
    const world = seedWorld({ configured: false });
    world.project.setProperty(
      'scpConfigJson',
      JSON.stringify({ version: 1, revision: 3, config: {} }),
    );
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.configured).toBe(false);
  });
});

describe('putConfig', () => {
  it('rejects a non-manager with FORBIDDEN', () => {
    const world = seedWorld();
    expect(() =>
      putConfig(ctxFor(world, MEMBER.login), { expectedRevision: 1, config: defaultConfig() }),
    ).toThrow(AppError);
    try {
      putConfig(ctxFor(world, MEMBER.login), { expectedRevision: 1, config: defaultConfig() });
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('lets the project leader bootstrap the first config', () => {
    const world = seedWorld({ configured: false });
    const res = putConfig(ctxFor(world, LEADER.login), {
      expectedRevision: 0,
      config: defaultConfig(),
    });
    expect(res.configured).toBe(true);
    expect(res.configRevision).toBe(1);
  });

  it('rejects a stale expectedRevision with CONFIG_REVISION_CONFLICT', () => {
    const world = seedWorld();
    try {
      putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 0, config: defaultConfig() });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('CONFIG_REVISION_CONFLICT');
    }
  });

  it('saves a valid config and bumps the revision, observable on the next load', () => {
    const world = seedWorld();
    const res = putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({ hoursPerDay: 6 }),
    });
    expect(res.configRevision).toBe(2);
    const after = getConfig(ctxFor(world, MANAGER.login));
    expect(after.configRevision).toBe(2);
    expect(after.config?.hoursPerDay).toBe(6);
  });
});
