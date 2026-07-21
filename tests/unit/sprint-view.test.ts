import { describe, it, expect } from 'vitest';
import { buildSprintView, type IssueLike, type NativeSprintLike } from '../../src/widgets/sprint-view.js';
import type { SprintEntry } from '../../src/shared/types.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';

const NATIVE: NativeSprintLike = {
  id: '207-1',
  name: 'AppGlass 2026-S1',
  goal: 'ship it',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

function entry(overrides: Partial<SprintEntry> = {}): SprintEntry {
  return {
    sequence: 1,
    name: NATIVE.name,
    start: NATIVE.start!,
    finish: NATIVE.finish!,
    capacityRevision: 3,
    capacity: makeDoc([makeRow({ userId: 'alice', availableMinutes: 4800 })]),
    focusFactor: 0.75,
    focusFactorSource: 'bootstrap',
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function issue(overrides: Partial<IssueLike>): IssueLike {
  return {
    id: 'AGP-1',
    originalEffortMinutes: null,
    currentEffortMinutes: null,
    resolved: false,
    resolvedAt: null,
    assigneeLogin: null,
    assigneeName: null,
    ...overrides,
  };
}

describe('buildSprintView', () => {
  it('assembles a managed view with live metrics from the current issue set', () => {
    const issues = [
      issue({ id: 'AGP-1', originalEffortMinutes: 600, currentEffortMinutes: 600, assigneeLogin: 'alice' }),
    ];
    const view = buildSprintView(NATIVE, entry(), issues, Date.UTC(2026, 0, 10));
    expect(view.managed).toBe(true);
    expect(view.sequence).toBe(1);
    expect(view.capacityRevision).toBe(3);
    expect(view.rawCapacityMinutes).toBe(4800);
    expect(view.plannedCapacityMinutes).toBe(3600); // 4800 × 0.75
    expect(view.originalEffortMinutes).toBe(600);
    expect(view.assignedEffort['alice']!.currentEffortMinutes).toBe(600);
    expect(view.completion).toBeNull(); // not yet past the finish day
  });

  it('produces an unmanaged, zero-capacity view when there is no app entry', () => {
    const view = buildSprintView(NATIVE, null, [], Date.UTC(2026, 0, 10));
    expect(view.managed).toBe(false);
    expect(view.sequence).toBe(0);
    expect(view.rawCapacityMinutes).toBe(0);
    expect(view.focusFactor).toBe(0.75); // bootstrap default
    expect(view.capacity.rows).toEqual({});
  });

  it('includes a completion snapshot once the finish day has passed', () => {
    const issues = [
      issue({ id: 'AGP-1', originalEffortMinutes: 2400, resolved: true, resolvedAt: Date.UTC(2026, 0, 10) }),
    ];
    const view = buildSprintView(NATIVE, entry(), issues, Date.UTC(2026, 0, 20));
    expect(view.completion).not.toBeNull();
    expect(view.completion!.completedOriginalEffortMinutes).toBe(2400);
    expect(view.observedFocusFactor).toBeCloseTo(0.5);
  });
});
