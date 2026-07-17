/**
 * Effort and capacity units.
 *
 * The internal unit for every effort/capacity value in the domain and backend is
 * the **minute**. Minutes avoid floating-point drift from hours and map cleanly to
 * YouTrack period fields (which YouTrack itself stores as minutes). Rounding to
 * days/hours happens ONLY at the UI/presentation boundary — never inside the domain.
 *
 * A "capacity day" is a configurable number of hours (default 8). Days are a
 * presentation convenience, not a storage unit.
 */

/** Minutes in one hour. */
export const MINUTES_PER_HOUR = 60;

/** Default working hours represented by one "capacity day" when config omits it. */
export const DEFAULT_HOURS_PER_DAY = 8;

/** Minutes → capacity days, given hoursPerDay. Not rounded. */
export function minutesToDays(minutes: number, hoursPerDay: number): number {
  if (hoursPerDay <= 0) {
    throw new RangeError(`hoursPerDay must be > 0, got ${hoursPerDay}`);
  }
  return minutes / (hoursPerDay * MINUTES_PER_HOUR);
}

/** Capacity days → minutes, given hoursPerDay. Result is an integer count of minutes. */
export function daysToMinutes(days: number, hoursPerDay: number): number {
  if (hoursPerDay <= 0) {
    throw new RangeError(`hoursPerDay must be > 0, got ${hoursPerDay}`);
  }
  return Math.round(days * hoursPerDay * MINUTES_PER_HOUR);
}

/**
 * Present a minute value as days for the UI, e.g. "10d" / "7.5d".
 * Rounds to the given precision (default 1 decimal). Presentation only.
 */
export function formatDays(minutes: number, hoursPerDay: number, precision = 1): string {
  return `${formatDaysValue(minutes, hoursPerDay, precision)}d`;
}

/**
 * Present a minute value as a plain float number of days (no unit), e.g. "10" / "7.5".
 * Used where a bare number reads better than a period, such as capacity-table cells.
 */
export function formatDaysValue(minutes: number, hoursPerDay: number, precision = 2): string {
  const days = minutesToDays(minutes, hoursPerDay);
  const factor = 10 ** precision;
  const rounded = Math.round(days * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
