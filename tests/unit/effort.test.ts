import { describe, it, expect } from 'vitest';
import { aggregateEffort, type EffortIssue } from '../../src/domain/effort/effort.js';

const START = Date.UTC(2026, 6, 13); // 2026-07-13
const FINISH = Date.UTC(2026, 6, 26); // 2026-07-26
const MID = Date.UTC(2026, 6, 20);

function issue(overrides: Partial<EffortIssue> = {}): EffortIssue {
  return {
    id: 'ISSUE-1',
    originalEffortMinutes: 100,
    currentEffortMinutes: 100,
    resolved: false,
    resolvedAt: null,
    ...overrides,
  };
}

describe('aggregateEffort', () => {
  it('sums original effort over all issues currently in the sprint', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', originalEffortMinutes: 100 }), issue({ id: 'B', originalEffortMinutes: 250 })],
      START,
      FINISH,
    );
    expect(r.originalEffortMinutes).toBe(350);
  });

  it('sums current effort over unresolved issues', () => {
    const r = aggregateEffort(
      [
        issue({ id: 'A', currentEffortMinutes: 100 }),
        issue({ id: 'B', currentEffortMinutes: 200 }),
      ],
      START,
      FINISH,
    );
    expect(r.currentEffortMinutes).toBe(300);
  });

  it('a resolved issue contributes 0 to current effort', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', currentEffortMinutes: 500, resolved: true, resolvedAt: MID })],
      START,
      FINISH,
    );
    expect(r.currentEffortMinutes).toBe(0);
  });

  it('missing original effort contributes 0 and is listed', () => {
    const r = aggregateEffort(
      [
        issue({ id: 'A', originalEffortMinutes: null }),
        issue({ id: 'B', originalEffortMinutes: 100 }),
      ],
      START,
      FINISH,
    );
    expect(r.originalEffortMinutes).toBe(100);
    expect(r.issuesMissingOriginalEffort).toEqual(['A']);
  });

  it('missing current effort contributes 0', () => {
    const r = aggregateEffort([issue({ id: 'A', currentEffortMinutes: null })], START, FINISH);
    expect(r.currentEffortMinutes).toBe(0);
    expect(r.issuesMissingOriginalEffort).toEqual([]);
  });

  it('completed original effort = original of issues resolved within [start, finish]', () => {
    const r = aggregateEffort(
      [
        issue({ id: 'A', originalEffortMinutes: 100, resolved: true, resolvedAt: MID }),
        issue({ id: 'B', originalEffortMinutes: 50, resolved: false }),
      ],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(100);
  });

  it('counts resolution exactly on the start and finish bounds (inclusive)', () => {
    const r = aggregateEffort(
      [
        issue({ id: 'A', originalEffortMinutes: 10, resolved: true, resolvedAt: START }),
        issue({ id: 'B', originalEffortMinutes: 20, resolved: true, resolvedAt: FINISH }),
      ],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(30);
  });

  it('excludes issues resolved before the sprint start', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', originalEffortMinutes: 100, resolved: true, resolvedAt: START - 1 })],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(0);
  });

  it('excludes issues resolved after the sprint finish', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', originalEffortMinutes: 100, resolved: true, resolvedAt: FINISH + 1 })],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(0);
  });

  it('a resolved issue with null resolvedAt does not count as completed', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', originalEffortMinutes: 100, resolved: true, resolvedAt: null })],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(0);
  });

  it('a resolved issue with null original effort does not count as completed', () => {
    const r = aggregateEffort(
      [issue({ id: 'A', originalEffortMinutes: null, resolved: true, resolvedAt: MID })],
      START,
      FINISH,
    );
    expect(r.completedOriginalEffortMinutes).toBe(0);
    expect(r.issuesMissingOriginalEffort).toEqual(['A']);
  });

  it('aggregates multiple mixed issues together', () => {
    const r = aggregateEffort(
      [
        issue({ id: 'A', originalEffortMinutes: 100, currentEffortMinutes: 80, resolved: false }),
        issue({
          id: 'B',
          originalEffortMinutes: 200,
          currentEffortMinutes: 999,
          resolved: true,
          resolvedAt: MID,
        }),
        issue({ id: 'C', originalEffortMinutes: null, currentEffortMinutes: 40, resolved: false }),
      ],
      START,
      FINISH,
    );
    expect(r).toEqual({
      originalEffortMinutes: 300,
      currentEffortMinutes: 120,
      completedOriginalEffortMinutes: 200,
      issuesMissingOriginalEffort: ['C'],
    });
  });

  it('returns all-zero aggregate for an empty issue list', () => {
    expect(aggregateEffort([], START, FINISH)).toEqual({
      originalEffortMinutes: 0,
      currentEffortMinutes: 0,
      completedOriginalEffortMinutes: 0,
      issuesMissingOriginalEffort: [],
    });
  });

  it('throws RangeError on negative original effort', () => {
    expect(() =>
      aggregateEffort([issue({ id: 'A', originalEffortMinutes: -1 })], START, FINISH),
    ).toThrow(RangeError);
  });

  it('throws RangeError on negative current effort', () => {
    expect(() =>
      aggregateEffort([issue({ id: 'A', currentEffortMinutes: -1 })], START, FINISH),
    ).toThrow(RangeError);
  });
});
