import { describe, it, expect } from 'vitest';
import { overrideFocusFactor, registerSprint, setCalibration } from '../../src/backend/handlers.js';
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

describe('overrideFocusFactor', () => {
  it('records a manual override with old/new values and the caller login on the team entry', () => {
    const world = setup();
    const { entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      reason: 'known holiday-heavy sprint',
      newValue: 0.4,
    });
    const team = entry.teams[TEAM_ID]!;
    expect(team.focusFactor).toBe(0.4);
    expect(team.focusFactorSource).toBe('manual');
    expect(team.focusFactorOverride).toMatchObject({
      oldValue: 0.75,
      newValue: 0.4,
      userId: MANAGER.login,
      reason: 'known holiday-heavy sprint',
    });
  });

  it('is team-scoped: overriding one team leaves the other untouched', () => {
    const world = seedWorld({ config: twoTeamConfig() });
    registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    const { entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      reason: 'Beta ramping up',
      newValue: 0.3,
    });
    expect(entry.teams[TEAM_2_ID]!.focusFactor).toBe(0.3);
    expect(entry.teams[TEAM_ID]!.focusFactor).toBe(0.75);
    expect(entry.teams[TEAM_ID]!.focusFactorOverride).toBeNull();
  });

  it('lazily materializes the team entry for a team added after registration', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    const { entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      reason: 'fresh team, conservative start',
      newValue: 0.5,
    });
    const added = entry.teams[TEAM_2_ID]!;
    expect(added.focusFactor).toBe(0.5);
    expect(added.focusFactorSource).toBe('manual');
    expect(added.focusFactorOverride!.oldValue).toBe(0.75); // the materialized bootstrap value
    expect(added.capacityRevision).toBe(0); // matches the empty view the client shows
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
  it('excludes a Sprint team with a reason and includes it back', () => {
    const world = setup();
    const excluded = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      excluded: true,
      reason: 'onboarding sprint',
    }).entry.teams[TEAM_ID]!;
    expect(excluded.excludedFromCalibration).toBe(true);
    expect(excluded.calibrationSkipReason).toBe('onboarding sprint');

    const included = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      excluded: false,
    }).entry.teams[TEAM_ID]!;
    expect(included.excludedFromCalibration).toBe(false);
    expect(included.calibrationSkipReason).toBeNull();
  });

  it('is team-scoped and lazily materializes a missing team entry', () => {
    const world = setup();
    storeConfig(world, twoTeamConfig());
    const { entry } = setCalibration(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      teamId: TEAM_2_ID,
      excluded: true,
      reason: 'no data yet',
    });
    expect(entry.teams[TEAM_2_ID]!.excludedFromCalibration).toBe(true);
    expect(entry.teams[TEAM_2_ID]!.capacityRevision).toBe(0);
    expect(entry.teams[TEAM_ID]!.excludedFromCalibration).toBe(false);
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
