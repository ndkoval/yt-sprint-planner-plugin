import { describe, it, expect } from 'vitest';
import {
  canReadSprint,
  canEditCapacityRow,
  canEditSettings,
  canOverrideFocusFactor,
  canChangeCalibration,
  canRecalculate,
  canImportExport,
  canReadDiagnostics,
  canCreateSprint,
  canEditSprintDetails,
  type Principal,
} from '../../src/domain/permissions/permissions.js';

const member: Principal = { userId: '1-10', isManager: false };
const other: Principal = { userId: '1-20', isManager: false };
const manager: Principal = { userId: '1-99', isManager: true };

describe('canReadSprint', () => {
  it('allows any authenticated principal', () => {
    expect(canReadSprint(member)).toBe(true);
    expect(canReadSprint(manager)).toBe(true);
  });
});

describe('canEditCapacityRow', () => {
  it('allows editing your own row', () => {
    expect(canEditCapacityRow(member, { targetUserId: member.userId })).toBe(true);
  });

  it('denies a non-manager editing another row', () => {
    expect(canEditCapacityRow(member, { targetUserId: other.userId })).toBe(false);
  });

  it('allows a manager to edit any row', () => {
    expect(canEditCapacityRow(manager, { targetUserId: other.userId })).toBe(true);
  });
});

describe('manager-only actions', () => {
  const actions = [
    canEditSettings,
    canOverrideFocusFactor,
    canChangeCalibration,
    canRecalculate,
    canImportExport,
    canReadDiagnostics,
  ];

  it('reject non-managers', () => {
    for (const action of actions) expect(action(member)).toBe(false);
  });

  it('allow managers', () => {
    for (const action of actions) expect(action(manager)).toBe(true);
  });
});

describe('canCreateSprint / canEditSprintDetails', () => {
  it('requires manager role (YouTrack enforces the real board permission separately)', () => {
    expect(canCreateSprint(manager)).toBe(true);
    expect(canCreateSprint(member)).toBe(false);
  });

  it('canEditSprintDetails aliases canCreateSprint', () => {
    expect(canEditSprintDetails).toBe(canCreateSprint);
  });
});
