/**
 * Sprint name generation and sequence computation. See §7.5.
 *
 * Template placeholders: {year} {sequence} {startDate} {finishDate}
 * Default template: "AppGlass {year}-S{sequence}"
 */
import type { IsoDate } from '../dates/dates.js';

export interface NameContext {
  year: number;
  sequence: number;
  startDate: IsoDate;
  finishDate: IsoDate;
}

const PLACEHOLDER_RE = /\{(year|sequence|startDate|finishDate)\}/g;

/** Render a Sprint name from the template and context. Unknown placeholders are left intact. */
export function renderSprintName(template: string, ctx: NameContext): string {
  return template.replace(PLACEHOLDER_RE, (_match, key: keyof NameContext) => String(ctx[key]));
}

/**
 * Compute the next sequence number. Sequence is monotonically increasing across
 * all managed Sprints regardless of year, so the highest existing sequence + 1.
 * Returns 1 when there are no managed Sprints yet.
 */
export function nextSequence(existingSequences: readonly number[]): number {
  if (existingSequences.length === 0) return 1;
  return Math.max(...existingSequences) + 1;
}

/** True if `candidate` collides (case-insensitive, trimmed) with any existing name. */
export function isDuplicateName(candidate: string, existingNames: readonly string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const c = norm(candidate);
  return existingNames.some((n) => norm(n) === c);
}
