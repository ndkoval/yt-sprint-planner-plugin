/**
 * Capacity calculations. All values in minutes; rounding is caller/UI concern.
 *
 * See §9 of the spec. Every function here is pure.
 */
import { MINUTES_PER_HOUR } from '../../shared/units.js';
import type { CapacityDocument, CapacityRow } from '../../shared/types.js';
import { countWorkingDays, type IsoDate } from '../dates/dates.js';

/**
 * Default capacity in minutes for one person (everyone is allocated at 100%):
 *   workingDays × hoursPerDay × 60
 * Rounded to whole minutes.
 */
export function defaultCapacityMinutes(workingDays: number, hoursPerDay: number): number {
  if (workingDays < 0) throw new RangeError(`workingDays must be >= 0, got ${workingDays}`);
  if (hoursPerDay <= 0) throw new RangeError(`hoursPerDay must be > 0, got ${hoursPerDay}`);
  return Math.round(workingDays * hoursPerDay * MINUTES_PER_HOUR);
}

/** Default capacity from Sprint dates (convenience wrapper over {@link defaultCapacityMinutes}). */
export function defaultCapacityForSprint(
  start: IsoDate,
  finish: IsoDate,
  hoursPerDay: number,
): number {
  return defaultCapacityMinutes(countWorkingDays(start, finish), hoursPerDay);
}

/**
 * Rows that contribute to capacity aggregates. Capacity rows are only created for
 * enabled participants, so every row in the document counts.
 */
function enabledRows(doc: CapacityDocument): CapacityRow[] {
  return Object.values(doc.rows);
}

/** Raw Capacity = sum(availableMinutes) over all enabled participants. */
export function rawCapacityMinutes(doc: CapacityDocument): number {
  return enabledRows(doc).reduce((sum, r) => sum + r.availableMinutes, 0);
}

/** Confirmed Capacity = sum(availableMinutes) over confirmed, enabled participants. Informational. */
export function confirmedCapacityMinutes(doc: CapacityDocument): number {
  return enabledRows(doc)
    .filter((r) => r.confirmed)
    .reduce((sum, r) => sum + r.availableMinutes, 0);
}

/** Planned Capacity = Raw Capacity × Focus Factor. Rounded to whole minutes. */
export function plannedCapacityMinutes(rawMinutes: number, focusFactor: number): number {
  if (focusFactor < 0) throw new RangeError(`focusFactor must be >= 0, got ${focusFactor}`);
  return Math.round(rawMinutes * focusFactor);
}

/**
 * Remaining Capacity = Planned Capacity − Current Effort (remaining work on unresolved
 * issues). May be negative when the Sprint is over-committed. This is the value that
 * changes automatically as issues are added, estimated, or resolved.
 */
export function remainingCapacityMinutes(
  plannedMinutes: number,
  currentEffortMinutes: number,
): number {
  return plannedMinutes - currentEffortMinutes;
}

/** Count of enabled participants who have confirmed, and the enabled total. */
export function confirmationCounts(doc: CapacityDocument): { confirmed: number; total: number } {
  const rows = enabledRows(doc);
  return { confirmed: rows.filter((r) => r.confirmed).length, total: rows.length };
}

/**
 * Recompute each row's `defaultMinutes` for new Sprint dates. Rows whose available
 * was NOT customized track the new default; customized rows keep their available
 * value (the UI offers "Reset to default" instead of overwriting). Pure — returns
 * a new document.
 */
export function reapplyDefaults(
  doc: CapacityDocument,
  start: IsoDate,
  finish: IsoDate,
  hoursPerDay: number,
): CapacityDocument {
  const workingDays = countWorkingDays(start, finish);
  const rows: Record<string, CapacityRow> = {};
  for (const [userId, row] of Object.entries(doc.rows)) {
    const newDefault = defaultCapacityMinutes(workingDays, hoursPerDay);
    rows[userId] = {
      ...row,
      defaultMinutes: newDefault,
      availableMinutes: row.availableWasCustomized ? row.availableMinutes : newDefault,
    };
  }
  return { ...doc, rows };
}
