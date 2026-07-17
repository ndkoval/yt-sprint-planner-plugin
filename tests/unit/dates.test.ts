import { describe, it, expect } from 'vitest';
import {
  isoToUtcMs,
  utcMsToIso,
  addDays,
  isWeekday,
  countWorkingDays,
  nextSprintDates,
  firstSprintDates,
  isWithinSprint,
} from '../../src/domain/dates/dates.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('isoToUtcMs / utcMsToIso', () => {
  it('parses a yyyy-mm-dd string to UTC midnight', () => {
    expect(isoToUtcMs('2026-07-16')).toBe(Date.UTC(2026, 6, 16));
  });

  it('round-trips iso -> ms -> iso', () => {
    const iso = '2024-02-29';
    expect(utcMsToIso(isoToUtcMs(iso))).toBe(iso);
  });

  it('round-trips ms -> iso -> ms', () => {
    const ms = Date.UTC(2030, 11, 31);
    expect(isoToUtcMs(utcMsToIso(ms))).toBe(ms);
  });

  it('computes at UTC midnight with no time-of-day component', () => {
    const ms = isoToUtcMs('2026-03-01');
    const d = new Date(ms);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it('throws on malformed strings', () => {
    expect(() => isoToUtcMs('2026-7-16')).toThrow(RangeError);
    expect(() => isoToUtcMs('not-a-date')).toThrow(RangeError);
    expect(() => isoToUtcMs('2026/07/16')).toThrow(RangeError);
  });

  it('throws on an out-of-range month', () => {
    expect(() => isoToUtcMs('2026-13-01')).toThrow(RangeError);
    expect(() => isoToUtcMs('2026-00-01')).toThrow(RangeError);
  });

  it('throws on a calendar-overflow date (2026-02-30)', () => {
    expect(() => isoToUtcMs('2026-02-30')).toThrow(RangeError);
  });

  it('accepts a valid leap-year Feb 29 but rejects a non-leap Feb 29', () => {
    expect(() => isoToUtcMs('2024-02-29')).not.toThrow();
    expect(() => isoToUtcMs('2023-02-29')).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('adds whole calendar days', () => {
    const base = isoToUtcMs('2026-01-01');
    expect(addDays(base, 5)).toBe(base + 5 * MS_PER_DAY);
  });

  it('supports negative offsets', () => {
    const base = isoToUtcMs('2026-01-10');
    expect(utcMsToIso(addDays(base, -1))).toBe('2026-01-09');
  });
});

describe('isWeekday', () => {
  it('is true for Monday through Friday', () => {
    // 2026-07-13 is a Monday.
    for (let i = 0; i < 5; i += 1) {
      expect(isWeekday(isoToUtcMs(`2026-07-${13 + i}`))).toBe(true);
    }
  });

  it('is false for Saturday and Sunday', () => {
    expect(isWeekday(isoToUtcMs('2026-07-18'))).toBe(false); // Saturday
    expect(isWeekday(isoToUtcMs('2026-07-19'))).toBe(false); // Sunday
  });
});

describe('countWorkingDays', () => {
  it('counts a full inclusive Mon-Fri week as 5', () => {
    expect(countWorkingDays('2026-07-13', '2026-07-17')).toBe(5);
  });

  it('counts 10 weekdays over two weeks (worked example)', () => {
    // 2024-01-01 is a Monday; through 2024-01-12 (Friday) = 10 weekdays.
    expect(countWorkingDays('2024-01-01', '2024-01-12')).toBe(10);
  });

  it('is inclusive of both bounds when both are weekdays', () => {
    expect(countWorkingDays('2026-07-13', '2026-07-13')).toBe(1);
  });

  it('returns 0 for a weekend-only span', () => {
    expect(countWorkingDays('2026-07-18', '2026-07-19')).toBe(0);
  });

  it('counts across a month boundary', () => {
    // 2026-01-26 (Mon) .. 2026-02-06 (Fri): 10 weekdays.
    expect(countWorkingDays('2026-01-26', '2026-02-06')).toBe(10);
  });

  it('counts across a year boundary', () => {
    // 2025-12-29 (Mon) .. 2026-01-09 (Fri): 10 weekdays.
    expect(countWorkingDays('2025-12-29', '2026-01-09')).toBe(10);
  });

  it('counts a leap-year February correctly', () => {
    // Feb 2024 has 29 days; weekdays = 21.
    expect(countWorkingDays('2024-02-01', '2024-02-29')).toBe(21);
  });

  it('throws when finish is before start', () => {
    expect(() => countWorkingDays('2026-07-17', '2026-07-13')).toThrow(RangeError);
  });
});

describe('firstSprintDates', () => {
  it('spans sprintLengthDays inclusive from the configured start', () => {
    expect(firstSprintDates('2026-07-13', 14)).toEqual({
      start: '2026-07-13',
      finish: '2026-07-26',
    });
  });

  it('handles a single-day sprint', () => {
    expect(firstSprintDates('2026-07-13', 1)).toEqual({
      start: '2026-07-13',
      finish: '2026-07-13',
    });
  });

  it('rejects a non-positive or non-integer length', () => {
    expect(() => firstSprintDates('2026-07-13', 0)).toThrow(RangeError);
    expect(() => firstSprintDates('2026-07-13', -1)).toThrow(RangeError);
    expect(() => firstSprintDates('2026-07-13', 2.5)).toThrow(RangeError);
  });
});

describe('nextSprintDates', () => {
  it('is continuous: nextStart = prevFinish + 1, nextFinish = start + length - 1', () => {
    const prev = firstSprintDates('2026-07-13', 14);
    const next = nextSprintDates(prev.finish, 14);
    expect(next.start).toBe('2026-07-27');
    expect(next.finish).toBe('2026-08-09');
    // Continuity: exactly one day after the previous finish.
    expect(isoToUtcMs(next.start)).toBe(addDays(isoToUtcMs(prev.finish), 1));
    // Length: finish - start + 1 === length.
    const days = (isoToUtcMs(next.finish) - isoToUtcMs(next.start)) / MS_PER_DAY + 1;
    expect(days).toBe(14);
  });

  it('crosses year boundaries continuously', () => {
    const next = nextSprintDates('2025-12-31', 5);
    expect(next).toEqual({ start: '2026-01-01', finish: '2026-01-05' });
  });

  it('rejects a non-positive or non-integer length', () => {
    expect(() => nextSprintDates('2026-07-13', 0)).toThrow(RangeError);
    expect(() => nextSprintDates('2026-07-13', 1.5)).toThrow(RangeError);
  });
});

describe('isWithinSprint', () => {
  const start = isoToUtcMs('2026-07-13');
  const finish = isoToUtcMs('2026-07-17');

  it('is inclusive of both bounds', () => {
    expect(isWithinSprint(start, start, finish)).toBe(true);
    expect(isWithinSprint(finish, start, finish)).toBe(true);
  });

  it('is false outside the range', () => {
    expect(isWithinSprint(addDays(start, -1), start, finish)).toBe(false);
    expect(isWithinSprint(addDays(finish, 1), start, finish)).toBe(false);
  });
});
