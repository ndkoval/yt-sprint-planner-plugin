/**
 * Calendar date math for Sprint scheduling and working-day counting.
 *
 * Sprint dates are calendar dates (no time-of-day meaning for scheduling), so all
 * arithmetic here is done on UTC midnight to avoid DST / local-timezone drift. A
 * "working day" is Monday–Friday. Callers convert to/from YouTrack's start/finish
 * epoch-ms at the REST boundary.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** yyyy-mm-dd string. */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a yyyy-mm-dd string to a UTC-midnight epoch ms. Throws on malformed input. */
export function isoToUtcMs(iso: IsoDate): number {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) throw new RangeError(`invalid ISO date: ${iso}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) throw new RangeError(`invalid month in ${iso}`);
  const ms = Date.UTC(year, month - 1, day);
  // Reject overflow like 2026-02-30 (Date.UTC would roll it into March).
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`invalid calendar date: ${iso}`);
  }
  return ms;
}

/**
 * Last instant (23:59:59.999 UTC) of a yyyy-mm-dd day. Used as the inclusive upper
 * bound for "resolved within the Sprint": work closed any time on the finish day counts.
 */
export function endOfDayUtcMs(iso: IsoDate): number {
  return isoToUtcMs(iso) + (24 * 60 * 60 * 1000 - 1);
}

/** Format a UTC-midnight epoch ms as yyyy-mm-dd. */
export function utcMsToIso(ms: number): IsoDate {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Add whole calendar days to a UTC epoch ms. */
export function addDays(ms: number, days: number): number {
  return ms + days * MS_PER_DAY;
}

/** True if the given UTC epoch ms falls on Monday–Friday. */
export function isWeekday(ms: number): boolean {
  const dow = new Date(ms).getUTCDay(); // 0=Sun … 6=Sat
  return dow >= 1 && dow <= 5;
}

/**
 * Count Monday–Friday dates between start and finish, inclusive.
 * Both bounds are yyyy-mm-dd. Throws if finish is before start.
 */
export function countWorkingDays(start: IsoDate, finish: IsoDate): number {
  const startMs = isoToUtcMs(start);
  const finishMs = isoToUtcMs(finish);
  if (finishMs < startMs) {
    throw new RangeError(`finish (${finish}) is before start (${start})`);
  }
  let count = 0;
  for (let ms = startMs; ms <= finishMs; ms = addDays(ms, 1)) {
    if (isWeekday(ms)) count += 1;
  }
  return count;
}

/**
 * Compute the next Sprint's [start, finish] from the previous Sprint's finish,
 * under the continuous policy:
 *   nextStart  = previousFinish + 1 calendar day
 *   nextFinish = nextStart + (sprintLengthDays - 1) calendar days
 */
export function nextSprintDates(
  previousFinish: IsoDate,
  sprintLengthDays: number,
): { start: IsoDate; finish: IsoDate } {
  if (!Number.isInteger(sprintLengthDays) || sprintLengthDays <= 0) {
    throw new RangeError(`sprintLengthDays must be a positive integer, got ${sprintLengthDays}`);
  }
  const startMs = addDays(isoToUtcMs(previousFinish), 1);
  const finishMs = addDays(startMs, sprintLengthDays - 1);
  return { start: utcMsToIso(startMs), finish: utcMsToIso(finishMs) };
}

/** Compute the first Sprint's [start, finish] from a configured first-start date. */
export function firstSprintDates(
  firstSprintStart: IsoDate,
  sprintLengthDays: number,
): { start: IsoDate; finish: IsoDate } {
  if (!Number.isInteger(sprintLengthDays) || sprintLengthDays <= 0) {
    throw new RangeError(`sprintLengthDays must be a positive integer, got ${sprintLengthDays}`);
  }
  const startMs = isoToUtcMs(firstSprintStart);
  const finishMs = addDays(startMs, sprintLengthDays - 1);
  return { start: utcMsToIso(startMs), finish: utcMsToIso(finishMs) };
}

/** True if `resolvedAt` (UTC ms) falls within [startMs, finishMs] inclusive of the finish day. */
export function isWithinSprint(resolvedAt: number, startMs: number, finishMs: number): boolean {
  return resolvedAt >= startMs && resolvedAt <= finishMs;
}
