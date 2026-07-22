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
    expect(res.config?.teams.map((t) => t.id)).toEqual([TEAM_ID]);
    // Since v4 every planning setting lives ON the team.
    expect(res.config?.teams[0]?.boardId).toBe('board-1');
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

  it('migrates a stored v2 (pre-teams) config on read: participants and every project-level setting become team-1, managersGroup is dropped', () => {
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
    expect(res.config?.version).toBe(4);
    // The chain runs v2→v3→v4: the flat participants become team-1, and the v3→v4
    // step copies every shared planning setting INTO that team.
    expect(res.config?.teams).toEqual([
      defaultTeam({
        participants: [
          { userId: MEMBER.login, enabled: true, allocation: 1 },
          { userId: MEMBER_2.login, enabled: false, allocation: 0.5 },
        ],
      }),
    ]);
    // The shipped legacy default template is rewritten to the generic default.
    expect(res.config?.teams[0]?.nameTemplate).toBe('Sprint {sequence}');
    // The custom permission mechanism is gone: managersGroup is deliberately
    // stripped (the doc would fail the strict parse otherwise), and no shared
    // setting survives at the config level.
    expect(Object.keys(res.config!).sort()).toEqual(['teams', 'version']);
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
      config: defaultConfig({ teams: [defaultTeam({ hoursPerDay: 6 })] }),
    });
    expect(res.configRevision).toBe(2);
    const after = getConfig(ctxFor(world, MANAGER.login));
    expect(after.configRevision).toBe(2);
    expect(after.config?.teams[0]?.hoursPerDay).toBe(6);
  });

  it('persists a version 4 document (per-team settings model)', () => {
    const world = seedWorld();
    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: defaultConfig() });
    const stored = JSON.parse(world.project.getProperty('scpConfigJson')!) as {
      version: number;
      config: { version: number; teams: unknown[] };
    };
    expect(stored.version).toBe(4);
    expect(stored.config.version).toBe(4);
    expect(stored.config.teams).toHaveLength(1);
  });

  it('persists a team-level reminderLeadDays when set', () => {
    const world = seedWorld();
    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({ teams: [defaultTeam({ reminderLeadDays: 0 })] }),
    });
    const after = getConfig(ctxFor(world, MEMBER.login));
    expect(after.config?.teams[0]?.reminderLeadDays).toBe(0);
  });
});

describe('putConfig — sprint reconciliation (roster changes apply immediately)', () => {
  const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };
  /** A Sprint on Beta's OWN board (teams may plan on different boards since v4). */
  const BETA_SPRINT = { id: '208-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-11' };

  it('does NOT seed sprints for a newly added team — the team registers its own', () => {
    const world = seedWorld();
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: twoTeamConfig() });

    // No lazy materialization in v4: the brand-new team has NO managed Sprints…
    expect(getSprintData(ctxFor(world, MEMBER_2.login), TEAM_2_ID).sprints).toEqual({});
    // …and writes against a Sprint it never registered fail with NOT_FOUND.
    try {
      writeCapacity(ctxFor(world, MEMBER_2.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_2_ID,
        target: 'me',
        expectedRevision: 1,
        availableMinutes: 1000,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }

    // The new team gets its seeded entry by registering a Sprint itself.
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), {
      teamId: TEAM_2_ID,
      sprint: BETA_SPRINT,
    });
    expect(entry.capacityRevision).toBe(1);
    expect(Object.keys(entry.capacity.rows)).toEqual([MEMBER_2.login]);
    expect(entry.focusFactor).toBe(0.75);
    expect(entry.focusFactorSource).toBe('bootstrap');

    // The pre-existing team's entry stays untouched throughout.
    const existing = getSprintData(ctxFor(world, MEMBER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(existing.capacityRevision).toBe(1);
  });

  it('backfills capacity rows for newly added participants, bumping only that team', () => {
    // Alpha (team-1): MEMBER alone; Beta (team-2): MEMBER_2 alone, on its own board.
    const world = seedWorld({ config: twoTeamConfig() });
    registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_ID, sprint: SPRINT });
    registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_2_ID, sprint: BETA_SPRINT });
    // Customize the existing row so we can prove reconciliation leaves it alone.
    writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_ID,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 1000,
    });

    // MEMBER_2 joins Alpha (Beta's roster is unchanged).
    const grown = twoTeamConfig();
    grown.teams[0]!.participants.push({ userId: MEMBER_2.login, enabled: true, allocation: 1 });
    putConfig(ctxFor(world, MANAGER.login), { expectedRevision: 1, config: grown });

    const alpha = getSprintData(ctxFor(world, MEMBER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(Object.keys(alpha.capacity.rows).sort()).toEqual([MEMBER.login, MEMBER_2.login]);
    expect(alpha.capacityRevision).toBe(3); // 1 seed + 1 member edit + 1 reconcile backfill
    expect(alpha.capacity.rows[MEMBER.login]!.availableMinutes).toBe(1000); // customized row untouched
    expect(alpha.capacity.rows[MEMBER_2.login]!.defaultMinutes).toBe(4800);
    expect(alpha.capacity.rows[MEMBER_2.login]!.availableWasCustomized).toBe(false);

    const beta = getSprintData(ctxFor(world, MEMBER_2.login), TEAM_2_ID).sprints[BETA_SPRINT.id]!;
    expect(beta.capacityRevision).toBe(1); // the other team's Sprint is untouched
    expect(Object.keys(beta.capacity.rows)).toEqual([MEMBER_2.login]);
  });

  it('does not bump revisions or rewrite sprint data when the roster is unchanged', () => {
    const world = seedWorld();
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    const before = getSprintData(ctxFor(world, MEMBER.login), TEAM_ID).sprints[SPRINT.id]!;

    const spy = vi.spyOn(world.project, 'setProperty');
    // A non-roster change (the team's hoursPerDay) must not touch existing sprint state.
    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({ teams: [defaultTeam({ hoursPerDay: 6 })] }),
    });
    expect(spy.mock.calls.map(([name]) => name)).not.toContain('scpSprintDataJson');
    spy.mockRestore();

    const after = getSprintData(ctxFor(world, MEMBER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(after).toEqual(before); // same revisions, same updatedAt, same rows
  });

  it('leaves orphaned team entries untouched in storage when a team is removed from the config', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_ID, sprint: SPRINT });
    registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_2_ID, sprint: BETA_SPRINT });
    const orphanBefore = getSprintData(ctxFor(world, MEMBER_2.login), TEAM_2_ID).sprints;

    putConfig(ctxFor(world, MANAGER.login), {
      expectedRevision: 1,
      config: defaultConfig({
        teams: [defaultTeam({ name: 'Alpha', participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
      }),
    });

    // The removed team can no longer be addressed through the API…
    try {
      getSprintData(ctxFor(world, MEMBER_2.login), TEAM_2_ID);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
    // …but its Sprint map is retained byte-for-byte in storage (non-destructive).
    const stored = JSON.parse(world.project.getProperty('scpSprintDataJson')!) as {
      teams: Record<string, { sprints: Record<string, unknown> }>;
    };
    expect(stored.teams[TEAM_2_ID]!.sprints).toEqual(orphanBefore);
    // The remaining team is untouched by the removal.
    expect(getSprintData(ctxFor(world, MEMBER.login), TEAM_ID).sprints[SPRINT.id]!.capacityRevision).toBe(1);
  });
});
