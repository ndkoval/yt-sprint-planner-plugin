import { describe, it, expect } from 'vitest';
import {
  defaultCapacityMinutes,
  defaultCapacityForSprint,
  rawCapacityMinutes,
  plannedCapacityMinutes,
  remainingCapacityMinutes,
  committedFitMinutes,
  reapplyDefaults,
} from '../../src/domain/capacity/capacity.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';

describe('defaultCapacityMinutes', () => {
  it('applies workingDays x hoursPerDay x 60 at 100% (worked example: 4800)', () => {
    expect(defaultCapacityMinutes(10, 8)).toBe(4800);
  });

  it('scales with working days (5 weekdays -> 2400)', () => {
    expect(defaultCapacityMinutes(5, 8)).toBe(2400);
  });

  it('returns 0 for zero working days', () => {
    expect(defaultCapacityMinutes(0, 8)).toBe(0);
  });

  it('rounds to whole minutes', () => {
    // 1 * 7.33h * 60 = 439.8 -> 440
    expect(defaultCapacityMinutes(1, 7.33)).toBe(440);
  });

  it('rejects negative working days', () => {
    expect(() => defaultCapacityMinutes(-1, 8)).toThrow(RangeError);
  });

  it('rejects non-positive hoursPerDay', () => {
    expect(() => defaultCapacityMinutes(10, 0)).toThrow(RangeError);
    expect(() => defaultCapacityMinutes(10, -8)).toThrow(RangeError);
  });
});

describe('defaultCapacityForSprint', () => {
  it('derives working days from the sprint dates', () => {
    // 2024-01-01 .. 2024-01-12 = 10 weekdays.
    expect(defaultCapacityForSprint('2024-01-01', '2024-01-12', 8)).toBe(4800);
    // 2024-01-01 .. 2024-01-05 = 5 weekdays.
    expect(defaultCapacityForSprint('2024-01-01', '2024-01-05', 8)).toBe(2400);
  });
});

describe('rawCapacityMinutes', () => {
  it('sums availableMinutes over all rows', () => {
    const doc = makeDoc([
      makeRow({ userId: '1-1', availableMinutes: 4800 }),
      makeRow({ userId: '1-2', availableMinutes: 2400 }),
    ]);
    expect(rawCapacityMinutes(doc)).toBe(7200);
  });

  it('returns 0 for an empty document', () => {
    expect(rawCapacityMinutes(makeDoc([]))).toBe(0);
  });
});

describe('plannedCapacityMinutes', () => {
  it('is raw x focusFactor, rounded', () => {
    expect(plannedCapacityMinutes(4800, 0.75)).toBe(3600);
  });

  it('rounds to whole minutes', () => {
    // 4800 * 0.7333 = 3519.84 -> 3520
    expect(plannedCapacityMinutes(4800, 0.7333)).toBe(3520);
  });

  it('rejects a negative focus factor', () => {
    expect(() => plannedCapacityMinutes(4800, -0.1)).toThrow(RangeError);
  });
});

describe('remainingCapacityMinutes', () => {
  it('is planned capacity minus current effort', () => {
    expect(remainingCapacityMinutes(7200, 2400)).toBe(4800);
  });

  it('goes negative when over-committed', () => {
    expect(remainingCapacityMinutes(3600, 4800)).toBe(-1200);
  });

  it('drops as current effort grows (adding a task reduces remaining capacity)', () => {
    const planned = 7200;
    const before = remainingCapacityMinutes(planned, 2400);
    const afterAddingTask = remainingCapacityMinutes(planned, 2400 + 1800);
    expect(afterAddingTask).toBeLessThan(before);
    expect(before - afterAddingTask).toBe(1800);
  });
});

describe('committedFitMinutes', () => {
  it('is positive headroom when committed work fits the capacity', () => {
    expect(committedFitMinutes(10000, 8000)).toBe(2000);
  });

  it('is negative when over-committed', () => {
    expect(committedFitMinutes(8000, 10000)).toBe(-2000);
  });

  it('works per person (available vs assigned) and per Sprint (planned vs original)', () => {
    expect(committedFitMinutes(4800, 4800)).toBe(0); // exactly fits
    expect(committedFitMinutes(2400, 4800)).toBe(-2400); // one person over their capacity
  });
});

describe('reapplyDefaults', () => {
  it('recomputes defaults and tracks them for non-customized rows', () => {
    const doc = makeDoc([
      makeRow({
        userId: '1-1',
        defaultMinutes: 4800,
        availableMinutes: 4800,
        availableWasCustomized: false,
      }),
    ]);
    // 2024-01-01 .. 2024-01-05 = 5 weekdays -> 5*8*60 = 2400.
    const next = reapplyDefaults(doc, '2024-01-01', '2024-01-05', 8);
    expect(next.rows['1-1']!.defaultMinutes).toBe(2400);
    expect(next.rows['1-1']!.availableMinutes).toBe(2400);
  });

  it('keeps available for customized rows but still updates the default', () => {
    const doc = makeDoc([
      makeRow({
        userId: '1-1',
        defaultMinutes: 4800,
        availableMinutes: 1000,
        availableWasCustomized: true,
      }),
    ]);
    const next = reapplyDefaults(doc, '2024-01-01', '2024-01-05', 8);
    expect(next.rows['1-1']!.defaultMinutes).toBe(2400);
    expect(next.rows['1-1']!.availableMinutes).toBe(1000);
  });

  it('is pure: does not mutate the input document', () => {
    const doc = makeDoc([makeRow({ userId: '1-1', defaultMinutes: 4800 })]);
    const snapshot = JSON.parse(JSON.stringify(doc));
    reapplyDefaults(doc, '2024-01-01', '2024-01-05', 8);
    expect(doc).toEqual(snapshot);
  });
});
