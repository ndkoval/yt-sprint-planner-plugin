import { describe, it, expect, vi } from 'vitest';
import { getConfig, getSprintData, putConfig, registerSprint, writeCapacity } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import {
  ctxFor,
  defaultConfig,
  defaultTeam,
  LEADER,
  MANAGER,
  MEMBER,
  MEMBER_2,
  seedWorld,
  TEAM_ID,
  TEAM_2_ID,
  twoTeamConfig,
} from './setup.js';

describe('getConfig', () => {
  it('reports unconfigured when no config is stored', () => {
    const world = seedWorld({ configured: false });
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.configured).toBe(false);
    expect(res.config).toBeNull();
    expect(res.isManager).toBe(false);
  });

  it('returns config and isManager=true for a NON-leader holding UPDATE_PROJECT', () => {
    const world = seedWorld();
    const res = getConfig(ctxFor(world, MANAGER.login));
    expect(res.configured).toBe(true);
    expect(res.config?.boardId).toBe('board-1');
    expect(res.config?.teams.map((t) => t.id)).toEqual([TEAM_ID]);
    expect(res.configRevision).toBe(1);
    expect(res.isManager).toBe(true);
    expect(res.isProjectLeader).toBe(false); // manager purely by permission
  });

  it('treats the project leader as a manager even WITHOUT UPDATE_PROJECT (bootstrap)', () => {
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

  it('migrates a stored v2 (pre-teams) config on read: participants become team-1, managersGroup is dropped', () => {
    const world = seedWorld({ configured: false });
    world.project.setProperty(
      'scpConfigJson',
      JSON.stringify({
        version: 2,
        revision: 4,
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
          managersGroup: 'Capacity Managers',
          participants: [
            { userId: MEMBER.login, enabled: true, allocation: 1 },
            { userId: MEMBER_2.login, enabled: false, allocation: 0.5 },
          ],
        },
      }),
    );
    const res = getConfig(ctxFor(world, MEMBER.login));
    expect(res.configured).toBe(true);
    expect(res.configRevision).toBe(4);
    expect(res.config?.version).toBe(3);
    expect(res.config?.teams).toEqual([
      {
        id: TEAM_ID,
        name: 'Team 1',
        participants: [
          { userId: MEMBER.login, enabled: true, allocation: 1 },
          { userId: MEMBER_2.login, enabled: false, allocation: 0.5 },
        ],
      },
    ]);
    // The shipped legacy default template is rewritten to the generic default.
    expect(res.config?.nameTemplate).toBe('Sprint {sequence}');
    // The custom permission mechanism is gone: managersGroup is deliberately
    // stripped (the doc would fail the strict parse otherwise).
    expect(Object.keys(res.config!)).not.toContain('managersGroup');
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

  it('persists a version 3 document (teams model)', () => {
    const world = seedWorld();
    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: defaultConfig() });
    const stored = JSON.parse(world.project.getProperty('scpConfigJson')!) as {
      version: number;
      config: { version: number; teams: unknown[] };
    };
    expect(stored.version).toBe(3);
    expect(stored.config.version).toBe(3);
    expect(stored.config.teams).toHaveLength(1);
  });

  it('persists reminderLeadDays when set', () => {
    const world = seedWorld();
    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({ reminderLeadDays: 0 }),
    });
    const after = getConfig(ctxFor(world, MEMBER.login));
    expect(after.config?.reminderLeadDays).toBe(0);
  });
});

describe('putConfig — sprint reconciliation (roster changes apply immediately)', () => {
  const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };

  it('seeds a TeamSprintEntry (capacityRevision 1) in every managed Sprint for a newly added team', () => {
    const world = seedWorld();
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: twoTeamConfig() });

    const entry = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!;
    expect(Object.keys(entry.teams).sort()).toEqual([TEAM_ID, TEAM_2_ID]);
    const added = entry.teams[TEAM_2_ID]!;
    expect(added.capacityRevision).toBe(1);
    expect(Object.keys(added.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(added.capacity.rows[MEMBER_2.login]!.defaultMinutes).toBe(4800);
    expect(added.focusFactor).toBe(0.75);
    expect(added.focusFactorSource).toBe('bootstrap');
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(1); // pre-existing team untouched
  });

  it('backfills capacity rows for newly added participants, bumping only that team', () => {
    const oneMember = defaultConfig({
      teams: [defaultTeam({ participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
    });
    const world = seedWorld({ config: oneMember });
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    // Customize the existing row so we can prove reconciliation leaves it alone.
    writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 1000,
    });

    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: defaultConfig() });

    const team = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!.teams[TEAM_ID]!;
    expect(Object.keys(team.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    expect(team.capacityRevision).toBe(3); // 1 seed + 1 member edit + 1 reconcile backfill
    expect(team.capacity.rows[MEMBER.login]!.availableMinutes).toBe(1000); // customized row untouched
    expect(team.capacity.rows[MEMBER_2.login]!.defaultMinutes).toBe(4800);
    expect(team.capacity.rows[MEMBER_2.login]!.availableWasCustomized).toBe(false);
  });

  it('does not bump revisions or rewrite sprint data when the roster is unchanged', () => {
    const world = seedWorld();
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    const before = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!;

    const spy = vi.spyOn(world.project, 'setProperty');
    // A non-roster change (hoursPerDay) must not touch existing sprint state.
    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({ hoursPerDay: 6 }),
    });
    expect(spy.mock.calls.map(([name]) => name)).not.toContain('scpSprintDataJson');
    spy.mockRestore();

    const after = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!;
    expect(after).toEqual(before); // same revisions, same updatedAt, same rows
  });

  it('leaves orphaned team entries untouched when a team is removed from the config', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    const orphanBefore = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!.teams[
      TEAM_2_ID
    ]!;

    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({
        teams: [defaultTeam({ name: 'Alpha', participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
      }),
    });

    const entry = getSprintData(ctxFor(world, MEMBER.login)).sprints[SPRINT.id]!;
    expect(entry.teams[TEAM_2_ID]).toEqual(orphanBefore); // retained byte-for-byte
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(1);
  });
});
