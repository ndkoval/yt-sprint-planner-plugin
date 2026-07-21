import { describe, it, expect } from 'vitest';
import { registerSprint, resetCapacity, writeCapacity } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import {
  ctxFor,
  defaultConfig,
  defaultTeam,
  MANAGER,
  MEMBER,
  MEMBER_2,
  seedWorld,
  storeConfig,
  TEAM_ID,
  TEAM_2_ID,
  twoTeamConfig,
  type World,
} from './setup.js';

const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };

/** Seed a configured project with one managed Sprint (capacity seeded for both members). */
function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

/** Seed a two-team project (MEMBER in team-1 "Alpha", MEMBER_2 in team-2 "Beta"). */
function setupTwoTeams(): World {
  const world = seedWorld({ config: twoTeamConfig() });
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

describe('writeCapacity — own row (target "me")', () => {
  it('edits the caller own row and bumps the TEAM revision (teamId omitted on a 1-team config)', () => {
    const world = setup();
    const { entry } = writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 3000,
    });
    const team = entry.teams[TEAM_ID]!;
    expect(team.capacityRevision).toBe(2);
    expect(team.capacity.rows[MEMBER.login]!.availableMinutes).toBe(3000);
    expect(team.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(true);
    expect(team.capacity.rows[MEMBER.login]!.updatedBy).toBe(MEMBER.login);
  });

  it('rejects a stale expectedRevision with CAPACITY_REVISION_CONFLICT', () => {
    const world = setup();
    try {
      writeCapacity(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        target: 'me',
        expectedRevision: 0,
        availableMinutes: 3000,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('CAPACITY_REVISION_CONFLICT');
    }
  });
});

describe('writeCapacity — team resolution', () => {
  it('fails VALIDATION_FAILED with knownTeams when teamId is omitted on a multi-team config', () => {
    const world = setupTwoTeams();
    try {
      writeCapacity(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        target: 'me',
        expectedRevision: 1,
        availableMinutes: 3000,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
      expect((e as AppError).details).toEqual({
        teamId: null,
        knownTeams: [TEAM_ID, TEAM_2_ID],
      });
    }
  });

  it('fails VALIDATION_FAILED for an unknown teamId', () => {
    const world = setup();
    try {
      writeCapacity(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        teamId: 'team-99',
        target: 'me',
        expectedRevision: 1,
        availableMinutes: 3000,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
      expect((e as AppError).details['knownTeams']).toEqual([TEAM_ID]);
    }
  });

  it('writes to the addressed team only on a multi-team config', () => {
    const world = setupTwoTeams();
    const { entry } = writeCapacity(ctxFor(world, MEMBER_2.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 1500,
    });
    expect(entry.teams[TEAM_2_ID]!.capacityRevision).toBe(2);
    expect(entry.teams[TEAM_2_ID]!.capacity.rows[MEMBER_2.login]!.availableMinutes).toBe(1500);
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(1); // untouched
  });

  it('throws NOT_FOUND when the target is not a member of the addressed team', () => {
    const world = setupTwoTeams();
    try {
      // MEMBER_2 belongs to team-2; targeting them inside team-1 has no row to edit.
      writeCapacity(ctxFor(world, MANAGER.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_ID,
        target: { userId: MEMBER_2.login },
        expectedRevision: 1,
        availableMinutes: 100,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });
});

describe('writeCapacity — another row', () => {
  it('forbids a non-manager editing another user row', () => {
    const world = setup();
    try {
      writeCapacity(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        target: { userId: MEMBER_2.login },
        expectedRevision: 1,
        availableMinutes: 100,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('allows a manager to edit another user row (note + value)', () => {
    const world = setup();
    const { entry } = writeCapacity(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      target: { userId: MEMBER_2.login },
      expectedRevision: 1,
      availableMinutes: 100,
      note: 'PTO',
    });
    const rows = entry.teams[TEAM_ID]!.capacity.rows;
    expect(rows[MEMBER_2.login]!.availableMinutes).toBe(100);
    expect(rows[MEMBER_2.login]!.note).toBe('PTO');
    expect(rows[MEMBER_2.login]!.updatedBy).toBe(MANAGER.login);
  });
});

describe('writeCapacity — lazy materialization', () => {
  it('materializes a config team missing from the entry at revision 0, so expectedRevision 0 passes', () => {
    // Register with a single team, then add team-2 to the config afterwards.
    const world = setup();
    storeConfig(world, twoTeamConfig());
    const { entry } = writeCapacity(ctxFor(world, MEMBER_2.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      target: 'me',
      expectedRevision: 0,
      availableMinutes: 2000,
    });
    const added = entry.teams[TEAM_2_ID]!;
    expect(added.capacityRevision).toBe(1); // 0 (materialized) + 1 (this write)
    expect(added.capacity.rows[MEMBER_2.login]!.availableMinutes).toBe(2000);
    expect(entry.teams[TEAM_ID]!.capacityRevision).toBe(1); // original team untouched
  });

  it('rejects a non-zero expectedRevision against a not-yet-materialized team', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    try {
      writeCapacity(ctxFor(world, MEMBER_2.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_2_ID,
        target: 'me',
        expectedRevision: 1,
        availableMinutes: 2000,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('CAPACITY_REVISION_CONFLICT');
    }
  });

  it('creates a row on first edit for a participant added to the team after seeding', () => {
    const oneMember = defaultConfig({
      teams: [defaultTeam({ participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }] })],
    });
    const world = seedWorld({ config: oneMember });
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    storeConfig(world, defaultConfig()); // MEMBER_2 joins team-1

    const { entry } = writeCapacity(ctxFor(world, MEMBER_2.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 4000,
    });
    const team = entry.teams[TEAM_ID]!;
    expect(team.capacityRevision).toBe(2);
    expect(team.capacity.rows[MEMBER_2.login]!.availableMinutes).toBe(4000);
    expect(team.capacity.rows[MEMBER_2.login]!.defaultMinutes).toBe(4800);
  });
});

describe('resetCapacity', () => {
  it('resets a customised row back to its default', () => {
    const world = setup();
    const patched = writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 3000,
    }).entry;
    const { entry } = resetCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      userId: MEMBER.login,
      expectedRevision: patched.teams[TEAM_ID]!.capacityRevision,
    });
    const row = entry.teams[TEAM_ID]!.capacity.rows[MEMBER.login]!;
    expect(row.availableMinutes).toBe(4800);
    expect(row.availableWasCustomized).toBe(false);
  });

  it('rejects a stale revision on reset with a conflict', () => {
    const world = setup();
    try {
      resetCapacity(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        userId: MEMBER.login,
        expectedRevision: 99,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('CAPACITY_REVISION_CONFLICT');
    }
  });

  it('throws NOT_FOUND for a team with no entry in the Sprint (nothing to reset)', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    try {
      resetCapacity(ctxFor(world, MEMBER_2.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_2_ID,
        userId: MEMBER_2.login,
        expectedRevision: 0,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });
});
