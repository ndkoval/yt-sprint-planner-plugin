import { describe, it, expect } from 'vitest';
import { registerSprint, resetCapacity, writeCapacity } from '../../src/backend/handlers.js';
import { AppError } from '../../src/backend/errors.js';
import { ctxFor, MANAGER, MEMBER, MEMBER_2, seedWorld, type World } from './setup.js';

const SPRINT = { id: '207-1', name: 'AppGlass 2026-S1', start: '2026-01-05', finish: '2026-01-18' };

/** Seed a configured project with one managed Sprint (capacity seeded for both members). */
function setup(): World {
  const world = seedWorld();
  registerSprint(ctxFor(world, MANAGER.login), { sprint: SPRINT });
  return world;
}

describe('writeCapacity — own row (target "me")', () => {
  it('edits the caller own row and bumps the revision', () => {
    const world = setup();
    const { entry } = writeCapacity(ctxFor(world, MEMBER.login), {
      sprintId: SPRINT.id,
      target: 'me',
      expectedRevision: 1,
      availableMinutes: 3000,
    });
    expect(entry.capacityRevision).toBe(2);
    expect(entry.capacity.rows[MEMBER.login]!.availableMinutes).toBe(3000);
    expect(entry.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(true);
    expect(entry.capacity.rows[MEMBER.login]!.updatedBy).toBe(MEMBER.login);
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
    expect(entry.capacity.rows[MEMBER_2.login]!.availableMinutes).toBe(100);
    expect(entry.capacity.rows[MEMBER_2.login]!.note).toBe('PTO');
    expect(entry.capacity.rows[MEMBER_2.login]!.updatedBy).toBe(MANAGER.login);
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
      expectedRevision: patched.capacityRevision,
    });
    expect(entry.capacity.rows[MEMBER.login]!.availableMinutes).toBe(4800);
    expect(entry.capacity.rows[MEMBER.login]!.availableWasCustomized).toBe(false);
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
});
