/**
 * Computes a Sprint's full metric set from authoritative inputs: the capacity
 * document, the current issue set, the Sprint dates and the Focus Factor. This is
 * the single place that maps the pure domain calculations onto a Sprint record.
 */
import {
  aggregateEffort,
  endOfDayUtcMs,
  isoToUtcMs,
  observedFocusFactor,
  plannedCapacityMinutes,
  rawCapacityMinutes,
  type EffortIssue,
} from '../../domain/index.js';
import type { CapacityDocument, CompletionCalculation } from '../../shared/types.js';
import type { YtIssue } from '../repositories/youtrack-client.js';

export interface AssigneeEffort {
  originalEffortMinutes: number;
  currentEffortMinutes: number;
}

export interface ComputedMetrics {
  rawCapacityMinutes: number;
  plannedCapacityMinutes: number;
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  observedFocusFactor: number | null;
  issuesMissingOriginalEffort: string[];
  /** Per-assignee effort (keyed by user id) for per-person planning load. */
  assignedEffort: Record<string, AssigneeEffort>;
  /** Effort on issues left unassigned. */
  unassignedEffort: AssigneeEffort;
  /** Count of unresolved issues currently in the Sprint (for the carry-over prompt). */
  unresolvedIssueCount: number;
}

/** Map a transport issue to the domain effort issue. */
function toEffortIssue(issue: YtIssue): EffortIssue {
  return {
    id: issue.id,
    originalEffortMinutes: issue.originalEffortMinutes,
    currentEffortMinutes: issue.currentEffortMinutes,
    resolved: issue.resolved,
    resolvedAt: issue.resolvedAt,
    assigneeId: issue.assigneeId,
  };
}

/**
 * Compute every metric for a Sprint.
 *
 * @param capacity   The Sprint's capacity document (null ⇒ zero capacity).
 * @param issues     Issues currently in the native Sprint.
 * @param start      yyyy-mm-dd Sprint start.
 * @param finish     yyyy-mm-dd Sprint finish.
 * @param focusFactor The Sprint's current Focus Factor.
 */
export function computeMetrics(
  capacity: CapacityDocument | null,
  issues: readonly YtIssue[],
  start: string,
  finish: string,
  focusFactor: number,
): ComputedMetrics {
  const startMs = isoToUtcMs(start);
  // Inclusive of the whole finish day, so work resolved on the last Sprint day counts.
  const finishMs = endOfDayUtcMs(finish);
  const raw = capacity ? rawCapacityMinutes(capacity) : 0;
  const effort = aggregateEffort(issues.map(toEffortIssue), startMs, finishMs);
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

/** Build a completion snapshot for a completed Sprint from computed metrics (§8.4). */
export function buildCompletion(
  metrics: ComputedMetrics,
  start: string,
  finish: string,
  calculatedAt: number,
  calculationRevision: number,
): CompletionCalculation {
  return {
    version: 1,
    calculatedAt,
    sprintStart: isoToUtcMs(start),
    sprintFinish: endOfDayUtcMs(finish),
    rawCapacityMinutes: metrics.rawCapacityMinutes,
    originalEffortMinutes: metrics.originalEffortMinutes,
    completedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
    observedFocusFactor: metrics.observedFocusFactor,
    calculationRevision,
  };
}
