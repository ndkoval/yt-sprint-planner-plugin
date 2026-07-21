import { describe, it, expect } from 'vitest';
import { buildCompletion, computeMetrics, isCompletedSprint } from '../../src/domain/metrics/metrics.js';
import type { EffortIssue } from '../../src/domain/effort/effort.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';

const START = '2026-01-05';
const FINISH = '2026-01-18';

function issue(overrides: Partial<EffortIssue>): EffortIssue {
  return {
    id: 'AGP-1',
    originalEffortMinutes: null,
    currentEffortMinutes: null,
    resolved: false,
    resolvedAt: null,
    assigneeId: null,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('sums raw capacity from the document and applies the focus factor', () => {
    const capacity = makeDoc([
      makeRow({ userId: 'alice', availableMinutes: 4800 }),
      makeRow({ userId: 'bob', availableMinutes: 2400 }),
    ]);
    const metrics = computeMetrics(capacity, [], START, FINISH, 0.75);
    expect(metrics.rawCapacityMinutes).toBe(7200);
    expect(metrics.plannedCapacityMinutes).toBe(5400); // 7200 × 0.75
  });

  it('treats a null capacity document as zero capacity', () => {
    const metrics = computeMetrics(null, [], START, FINISH, 0.75);
    expect(metrics.rawCapacityMinutes).toBe(0);
    expect(metrics.plannedCapacityMinutes).toBe(0);
    expect(metrics.observedFocusFactor).toBeNull();
  });

  it('aggregates effort and per-assignee load from the current issue set', () => {
    const issues: EffortIssue[] = [
      issue({ id: 'AGP-1', originalEffortMinutes: 600, currentEffortMinutes: 600, assigneeId: 'alice' }),
      issue({ id: 'AGP-2', originalEffortMinutes: 300, currentEffortMinutes: 120, assigneeId: 'bob' }),
      issue({ id: 'AGP-3', originalEffortMinutes: null, assigneeId: null }),
    ];
    const metrics = computeMetrics(makeDoc([makeRow({ availableMinutes: 4800 })]), issues, START, FINISH, 0.75);
    expect(metrics.originalEffortMinutes).toBe(900);
    expect(metrics.currentEffortMinutes).toBe(720);
    expect(metrics.issuesMissingOriginalEffort).toEqual(['AGP-3']);
    expect(metrics.assignedEffort['alice']!.originalEffortMinutes).toBe(600);
    expect(metrics.unresolvedIssueCount).toBe(3);
  });

  it('counts effort resolved within the Sprint window as completed and derives the observed factor', () => {
    const withinMs = Date.UTC(2026, 0, 10);
    const issues: EffortIssue[] = [
      issue({ id: 'AGP-1', originalEffortMinutes: 2400, resolved: true, resolvedAt: withinMs }),
    ];
    const metrics = computeMetrics(makeDoc([makeRow({ availableMinutes: 4800 })]), issues, START, FINISH, 0.75);
    expect(metrics.completedOriginalEffortMinutes).toBe(2400);
    expect(metrics.observedFocusFactor).toBeCloseTo(0.5); // 2400 / 4800
    expect(metrics.currentEffortMinutes).toBe(0); // resolved issues contribute no current effort
  });
});

describe('isCompletedSprint', () => {
  it('is true only after the end of the finish day', () => {
    const duringFinishDay = Date.UTC(2026, 0, 18, 12);
    const afterFinishDay = Date.UTC(2026, 0, 19);
    expect(isCompletedSprint(FINISH, duringFinishDay)).toBe(false);
    expect(isCompletedSprint(FINISH, afterFinishDay)).toBe(true);
  });
});

describe('buildCompletion', () => {
  it('snapshots the completion figures from computed metrics', () => {
    const metrics = computeMetrics(makeDoc([makeRow({ availableMinutes: 4800 })]), [], START, FINISH, 0.75);
    const completion = buildCompletion(metrics, START, FINISH, 123);
    expect(completion.calculatedAt).toBe(123);
    expect(completion.rawCapacityMinutes).toBe(4800);
    expect(completion.sprintStart).toBe(Date.UTC(2026, 0, 5));
  });
});
