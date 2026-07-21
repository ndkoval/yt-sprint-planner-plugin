import { describe, it, expect } from 'vitest';
import { getSprintData, registerSprint } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { ctxFor, MANAGER, MEMBER, seedWorld } from './setup.js';

const SPRINT = { id: '207-1', name: 'AppGlass 2026-S1', start: '2026-01-05', finish: '2026-01-18' };

describe('registerSprint', () => {
  it('creates a new entry with sequence 1 and seeds capacity for enabled participants', () => {
    const world = seedWorld();
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
    expect(entry.sequence).toBe(1);
    expect(Object.keys(entry.capacity.rows).sort()).toEqual([MEMBER.login, 'member2']);
    // 10 working days (Mon–Fri across the window) × 8h × 60 = 4800 minutes.
    expect(entry.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(4800);
    expect(entry.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(false);
    expect(entry.focusFactor).toBe(0.75);
    expect(entry.focusFactorSource).toBe('bootstrap');
  });

  it('assigns increasing sequences to successive Sprints', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    const second = registerSprint(ctx, {
      sprint: { id: '207-2', name: 'S2', start: '2026-01-19', finish: '2026-02-01' },
    });
    expect(second.entry.sequence).toBe(2);
    expect(Object.keys(getSprintData(ctx).sprints)).toHaveLength(2);
  });

  it('carries a caller-supplied focus factor onto a new entry', () => {
    const world = seedWorld();
    const { entry } = registerSprint(ctxFor(world, MANAGER.login), {
      sprint: SPRINT,
      focusFactor: 0.6,
      focusFactorSource: 'calculated',
    });
    expect(entry.focusFactor).toBe(0.6);
    expect(entry.focusFactorSource).toBe('calculated');
  });

  it('re-registering with changed dates recomputes non-customized defaults and bumps revision', () => {
    const world = seedWorld();
    const ctx = ctxFor(world, MANAGER.login);
    registerSprint(ctx, { sprint: SPRINT });
    // Extend to a 4-week window (20 working days → 9600 minutes).
    const { entry } = registerSprint(ctx, {
      sprint: { ...SPRINT, finish: '2026-02-01' },
    });
    expect(entry.capacity.rows[MEMBER.login]!.defaultMinutes).toBe(9600);
    expect(entry.capacity.rows[MEMBER.login]!.availableMinutes).toBe(9600);
    expect(entry.capacityRevision).toBe(2);
  });

  it('adds rows for participants who joined the team after the Sprint was seeded', () => {
    // Seed with a single-member config, then widen the team and re-register.
    const oneMember = defaultConfigForOneMember();
    const world = seedWorld({ config: oneMember });
    const ctx = ctxFor(world, MANAGER.login);
    const first = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(first.entry.capacity.rows)).toEqual([MEMBER.login]);

    const twoMembers = { ...oneMember, participants: defaultTwoMembers() };
    world.project.setProperty(
      'scpConfigJson',
      JSON.stringify({ version: 2, revision: 2, config: twoMembers }),
    );
    const second = registerSprint(ctx, { sprint: SPRINT });
    expect(Object.keys(second.entry.capacity.rows).sort()).toEqual([MEMBER.login, 'member2']);
  });

  it('rejects a non-manager with FORBIDDEN', () => {
    const world = seedWorld();
    try {
      registerSprint(ctxFor(world, MEMBER.login), { sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });

  it('rejects a finish that is not after start', () => {
    const world = seedWorld();
    try {
      registerSprint(ctxFor(world, MANAGER.login), {
        sprint: { ...SPRINT, finish: SPRINT.start },
      });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('throws NOT_CONFIGURED when no config exists', () => {
    const world = seedWorld({ configured: false });
    try {
      registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('NOT_CONFIGURED');
    }
  });
});

function defaultConfigForOneMember() {
  const base = {
    version: 2 as const,
    boardId: 'board-1',
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous' as const,
    nameTemplate: 'AppGlass {year}-S{sequence}',
    backlogQuery: '',
    learningRate: 0.5,
    managersGroup: 'Capacity Managers',
    participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
  };
  return base;
}

function defaultTwoMembers() {
  return [
    { userId: MEMBER.login, enabled: true, allocation: 1 },
    { userId: 'member2', enabled: true, allocation: 1 },
  ];
}
