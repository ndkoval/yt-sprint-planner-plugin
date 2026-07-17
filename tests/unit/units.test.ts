import { describe, it, expect } from 'vitest';
import {
  MINUTES_PER_HOUR,
  DEFAULT_HOURS_PER_DAY,
  minutesToDays,
  daysToMinutes,
  formatDays,
} from '../../src/shared/units.js';

describe('constants', () => {
  it('define minutes per hour and default hours per day', () => {
    expect(MINUTES_PER_HOUR).toBe(60);
    expect(DEFAULT_HOURS_PER_DAY).toBe(8);
  });
});

describe('minutesToDays', () => {
  it('converts minutes to fractional days (not rounded)', () => {
    expect(minutesToDays(4800, 8)).toBe(10);
    expect(minutesToDays(3600, 8)).toBe(7.5);
  });

  it('rejects non-positive hoursPerDay', () => {
    expect(() => minutesToDays(4800, 0)).toThrow(RangeError);
    expect(() => minutesToDays(4800, -8)).toThrow(RangeError);
  });
});

describe('daysToMinutes', () => {
  it('converts days to whole minutes', () => {
    expect(daysToMinutes(10, 8)).toBe(4800);
    expect(daysToMinutes(7.5, 8)).toBe(3600);
  });

  it('rounds to the nearest minute', () => {
    // 0.001 day * 8 * 60 = 0.48 -> 0
    expect(daysToMinutes(0.001, 8)).toBe(0);
  });

  it('rejects non-positive hoursPerDay', () => {
    expect(() => daysToMinutes(10, 0)).toThrow(RangeError);
  });
});

describe('formatDays', () => {
  it('drops trailing .0 for whole days', () => {
    expect(formatDays(4800, 8)).toBe('10d');
  });

  it('shows one decimal by default for fractional days', () => {
    expect(formatDays(3600, 8)).toBe('7.5d');
  });

  it('rounds to the requested precision', () => {
    // 4810 / 480 = 10.0208.. -> "10d" at precision 1 (rounds to 10.0 -> whole)
    expect(formatDays(4810, 8)).toBe('10d');
    // At precision 2 it keeps the decimals.
    expect(formatDays(4810, 8, 2)).toBe('10.02d');
  });

  it('formats zero', () => {
    expect(formatDays(0, 8)).toBe('0d');
  });

  it('propagates the hoursPerDay validation', () => {
    expect(() => formatDays(4800, 0)).toThrow(RangeError);
  });
});
