/**
 * Computes a Sprint's full metric set from authoritative inputs: the capacity
 * document, the current issue set, the Sprint dates and the Focus Factor. Metrics
 * are always computed live on read — there is no cached copy to go stale.
 */
import type { CapacityDocument, CompletionCalculation } from '../../shared/types.js';
import { plannedCapacityMinutes, rawCapacityMinutes } from '../capacity/capacity.js';
import { endOfDayUtcMs, isoToUtcMs } from '../dates/dates.js';
import { aggregateEffort, type AssigneeEffort, type EffortIssue } from '../effort/effort.js';
import { observedFocusFactor } from '../focus-factor/focus-factor.js';

export interface ComputedMetrics {
  rawCapacityMinutes: number;
  plannedCapacityMinutes: number;
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  observedFocusFactor: number | null;
  issuesMissingOriginalEffort: string[];
  /** Per-assignee effort (keyed by user login) for per-person planning load. */
  assignedEffort: Record<string, AssigneeEffort>;
  /** Effort on issues left unassigned. */
  unassignedEffort: AssigneeEffort;
  /** Count of unresolved issues currently in the Sprint (for the carry-over prompt). */
  unresolvedIssueCount: number;
}

/**
 * Compute every metric for a Sprint.
 *
 * @param capacity    The Sprint's capacity document (null ⇒ zero capacity).
 * @param issues      Issues currently in the native Sprint.
 * @param start       yyyy-mm-dd Sprint start.
 * @param finish      yyyy-mm-dd Sprint finish.
 * @param focusFactor The Sprint's current Focus Factor.
 */
export function computeMetrics(
  capacity: CapacityDocument | null,
  issues: readonly EffortIssue[],
  start: string,
  finish: string,
  focusFactor: number,
): ComputedMetrics {
  const startMs = isoToUtcMs(start);
  // Inclusive of the whole finish day, so work resolved on the last Sprint day counts.
  const finishMs = endOfDayUtcMs(finish);
  const raw = capacity ? rawCapacityMinutes(capacity) : 0;
  const effort = aggregateEffort(issues, startMs, finishMs);
  return {
    rawCapacityMinutes: raw,
    plannedCapacityMinutes: plannedCapacityMinutes(raw, focusFactor),
    originalEffortMinutes: effort.originalEffortMinutes,
    currentEffortMinutes: effort.currentEffortMinutes,
    completedOriginalEffortMinutes: effort.completedOriginalEffortMinutes,
    observedFocusFactor: observedFocusFactor(effort.completedOriginalEffortMinutes, raw),
    issuesMissingOriginalEffort: effort.issuesMissingOriginalEffort,
    assignedEffort: effort.byAssignee,
    unassignedEffort: effort.unassigned,
    unresolvedIssueCount: issues.filter((i) => !i.resolved).length,
  };
}

/** A Sprint is "completed" once the end of its finish day has passed. */
export function isCompletedSprint(finish: string, nowMs: number): boolean {
  return nowMs > endOfDayUtcMs(finish);
}

/** Build the live completion figures for a completed Sprint from computed metrics. */
export function buildCompletion(
  metrics: ComputedMetrics,
  start: string,
  finish: string,
  calculatedAt: number,
): CompletionCalculation {
  return {
    calculatedAt,
    sprintStart: isoToUtcMs(start),
    sprintFinish: endOfDayUtcMs(finish),
    rawCapacityMinutes: metrics.rawCapacityMinutes,
    originalEffortMinutes: metrics.originalEffortMinutes,
    completedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
    observedFocusFactor: metrics.observedFocusFactor,
  };
}
