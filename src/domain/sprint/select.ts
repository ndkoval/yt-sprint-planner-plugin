/**
 * Choosing which Sprint the planner opens on. The "relevant" Sprint is the one a
 * user expects to see first — the ACTIVE one (today falls within its dates), else
 * the most recent managed Sprint, else anything not archived. Pure and
 * unit-testable; the widget passes native Sprint summaries and today's yyyy-mm-dd.
 */

/** The minimal Sprint shape the picker needs (a subset of SprintSummary). */
export interface SelectableSprint {
  id: string;
  /** yyyy-mm-dd, or '' when the Sprint has no dates. */
  start: string;
  finish: string;
  archived: boolean;
  managed: boolean;
  sequence: number;
}

/** True when `today` (yyyy-mm-dd) falls within [start, finish] inclusive. */
function isActive(s: SelectableSprint, today: string): boolean {
  return s.start !== '' && s.finish !== '' && s.start <= today && today <= s.finish;
}

/**
 * The Sprint to open on, or null for an empty list. Priority:
 *   1. the ACTIVE managed Sprint (today within its dates) — the current one;
 *      if several overlap, the highest sequence (the most recently created);
 *   2. else the latest managed Sprint by sequence (the newest planned);
 *   3. else the first non-archived Sprint;
 *   4. else the first Sprint at all.
 * yyyy-mm-dd compares correctly as plain strings.
 */
export function pickRelevantSprint<T extends SelectableSprint>(
  sprints: readonly T[],
  today: string,
): T | null {
  if (sprints.length === 0) return null;
  const managed = sprints.filter((s) => s.managed && !s.archived);

  const active = managed
    .filter((s) => isActive(s, today))
    .sort((a, b) => b.sequence - a.sequence);
  if (active.length > 0) return active[0]!;

  if (managed.length > 0) {
    return managed.reduce((latest, s) => (s.sequence > latest.sequence ? s : latest));
  }

  return sprints.find((s) => !s.archived) ?? sprints[0]!;
}
