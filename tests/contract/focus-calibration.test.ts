import { describe, it, expect } from 'vitest';
import {
  getSprintData,
  overrideFocusFactor,
  registerSprint,
  setCalibration,
} from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import {
  ctxFor,
  MANAGER,
  MEMBER,
  seedWorld,
  storeConfig,
  TEAM_ID,
  TEAM_2_ID,
  twoTeamConfig,
  type World,
} from './setup.js';

const SPRINT = { id: '207-1', name: 'Sprint 1', start: '2026-01-05', finish: '2026-01-18' };

function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

/** Two-team world where BOTH teams registered the same native Sprint. */
function setupTwoTeams(): World {
  const world = seedWorld({ config: twoTeamConfig() });
  registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_ID, sprint: SPRINT });
  registerSprint(ctxFor(world, MANAGER.login), { teamId: TEAM_2_ID, sprint: SPRINT });
  return world;
}

describe('overrideFocusFactor', () => {
  it('records a manual override with old/new values and the caller login on the team entry', () => {
    const world = setup();
    const { teamId, entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      reason: 'known holiday-heavy sprint',
      newValue: 0.4,
    });
    expect(teamId).toBe(TEAM_ID);
    expect(entry.focusFactor).toBe(0.4);
    expect(entry.focusFactorSource).toBe('manual');
    expect(entry.focusFactorOverride).toMatchObject({
      oldValue: 0.75,
      newValue: 0.4,
      userId: MANAGER.login,
      reason: 'known holiday-heavy sprint',
    });
  });

  it('is team-scoped: overriding one team leaves the other untouched', () => {
    const world = setupTwoTeams();
    const { entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      reason: 'Beta ramping up',
      newValue: 0.3,
    });
    expect(entry.focusFactor).toBe(0.3);
    const alpha = getSprintData(ctxFor(world, MANAGER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(alpha.focusFactor).toBe(0.75);
    expect(alpha.focusFactorOverride).toBeNull();
  });

  it('throws NOT_FOUND for a team added after registration (no lazy materialization)', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    try {
      overrideFocusFactor(ctxFor(world, MANAGER.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_2_ID,
        reason: 'fresh team, conservative start',
        newValue: 0.5,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('forbids a non-manager', () => {
    const world = setup();
    try {
      overrideFocusFactor(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        reason: 'x',
        newValue: 0.5,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });
});

describe('setCalibration', () => {
  it('excludes a team Sprint with a reason and includes it back', () => {
    const world = setup();
    const excluded = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      excluded: true,
      reason: 'onboarding sprint',
    }).entry;
    expect(excluded.excludedFromCalibration).toBe(true);
    expect(excluded.calibrationSkipReason).toBe('onboarding sprint');

    const included = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      excluded: false,
    }).entry;
    expect(included.excludedFromCalibration).toBe(false);
    expect(included.calibrationSkipReason).toBeNull();
  });

  it('is team-scoped: excluding one team leaves the other included', () => {
    const world = setupTwoTeams();
    const { entry } = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      excluded: true,
      reason: 'no data yet',
    });
    expect(entry.excludedFromCalibration).toBe(true);
    expect(entry.calibrationSkipReason).toBe('no data yet');
    const alpha = getSprintData(ctxFor(world, MANAGER.login), TEAM_ID).sprints[SPRINT.id]!;
    expect(alpha.excludedFromCalibration).toBe(false);
  });

  it('throws NOT_FOUND for a team that never registered the Sprint (no lazy materialization)', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    try {
      setCalibration(ctxFor(world, MANAGER.login), {
        sprintId: SPRINT.id,
        teamId: TEAM_2_ID,
        excluded: true,
        reason: 'no data yet',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('forbids a non-manager', () => {
    const world = setup();
    try {
      setCalibration(ctxFor(world, MEMBER.login), {
        sprintId: SPRINT.id,
        excluded: true,
        reason: 'x',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('throws NOT_FOUND for an unknown Sprint', () => {
    const world = setup();
    try {
      setCalibration(ctxFor(world, MANAGER.login), {
        sprintId: 'nope',
        excluded: false,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });
});
