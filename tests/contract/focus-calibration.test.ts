import { describe, it, expect } from 'vitest';
import { overrideFocusFactor, registerSprint, setCalibration } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { ctxFor, MANAGER, MEMBER, seedWorld, type World } from './setup.js';

const SPRINT = { id: '207-1', name: 'AppGlass 2026-S1', start: '2026-01-05', finish: '2026-01-18' };

function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

describe('overrideFocusFactor', () => {
  it('records a manual override with old/new values and the caller login', () => {
    const world = setup();
    const { entry } = overrideFocusFactor(ctxFor(world, MANAGER.login), {
      sprintId: SPRINT.id,
      reason: 'known holiday-heavy sprint',
      newValue: 0.4,
    });
    expect(entry.focusFactor).toBe(0.4);
    expect(entry.focusFactorSource).toBe('manual');
    expect(entry.focusFactorOverride).toMatchObject({
      oldValue: 0.75,
      newValue: 0.4,
      userId: MANAGER.login,
      reason: 'known holiday-heavy sprint',
    });
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
  it('excludes a Sprint with a reason and includes it back', () => {
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
