/**
 * Pure assembly of the client-facing {@link SprintView} from native Sprint data, the
 * app's stored {@link SprintEntry}, and the current issue set. Metrics are computed
 * live here (compute-on-read) with the shared domain math — there is no cached copy to
 * go stale. Kept free of any host/DOM dependency so it is unit-testable in isolation.
 */
import {
  DEFAULT_FOCUS_FACTOR,
  buildCompletion,
  computeMetrics,
  isCompletedSprint,
  type EffortIssue,
} from '../domain/index.js';
import type { AssigneeEffortView, IssueView, SprintView } from '../shared/api.js';
import type { CapacityDocument, SprintEntry } from '../shared/types.js';

const EMPTY_CAPACITY: CapacityDocument = { version: 2, createdFromConfigVersion: 0, rows: {} };

/** Native Sprint fields the view needs (structurally satisfied by the REST client's YtSprint). */
export interface NativeSprintLike {
  id: string;
  name: string;
  goal: string;
  start: string | null;
  finish: string | null;
  archived: boolean;
}

/** Issue fields the view needs (structurally satisfied by the REST client's YtIssue). */
export interface IssueLike {
  id: string;
  idReadable?: string | undefined;
  summary?: string | undefined;
  originalEffortMinutes: number | null;
  currentEffortMinutes: number | null;
  resolved: boolean;
  resolvedAt: number | null;
  assigneeLogin: string | null;
  assigneeName: string | null;
}

export function toEffortIssue(issue: IssueLike): EffortIssue {
  return {
    id: issue.id,
    originalEffortMinutes: issue.originalEffortMinutes,
    currentEffortMinutes: issue.currentEffortMinutes,
    resolved: issue.resolved,
    resolvedAt: issue.resolvedAt,
    assigneeId: issue.assigneeLogin,
  };
}

export function toIssueView(issue: IssueLike): IssueView {
  return {
    id: issue.id,
    idReadable: issue.idReadable ?? issue.id,
    summary: issue.summary ?? '',
    assigneeId: issue.assigneeLogin,
    assigneeName: issue.assigneeName,
    originalEffortMinutes: issue.originalEffortMinutes,
    currentEffortMinutes: issue.currentEffortMinutes,
    resolved: issue.resolved,
  };
}

const ZERO_EFFORT: AssigneeEffortView = { originalEffortMinutes: 0, currentEffortMinutes: 0 };

/** Assemble the client-facing view from native data + app state, computing metrics live. */
export function buildSprintView(
  native: NativeSprintLike,
  entry: SprintEntry | null,
  issues: readonly IssueLike[],
  nowMs: number,
): SprintView {
  const focusFactor = entry?.focusFactor ?? DEFAULT_FOCUS_FACTOR;
  const hasDates = native.start !== null && native.finish !== null;
  const start = native.start ?? '1970-01-01';
  const finish = native.finish ?? '1970-01-02';
  const metrics = computeMetrics(
    entry?.capacity ?? null,
    hasDates ? issues.map(toEffortIssue) : [],
    start,
    finish,
    focusFactor,
  );
  const completed = hasDates && isCompletedSprint(finish, nowMs);
  return {
    id: native.id,
    name: native.name,
    goal: native.goal,
    start: native.start ?? '',
    finish: native.finish ?? '',
    archived: native.archived,
    managed: entry !== null,
    sequence: entry?.sequence ?? 0,
    capacityRevision: entry?.capacityRevision ?? 0,
    capacity: entry?.capacity ?? EMPTY_CAPACITY,
    focusFactor,
    focusFactorSource: entry?.focusFactorSource ?? 'bootstrap',
    focusFactorOverride: entry?.focusFactorOverride ?? null,
    rawCapacityMinutes: metrics.rawCapacityMinutes,
    plannedCapacityMinutes: metrics.plannedCapacityMinutes,
    originalEffortMinutes: metrics.originalEffortMinutes,
    currentEffortMinutes: metrics.currentEffortMinutes,
    completedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
    observedFocusFactor: metrics.observedFocusFactor,
    excludedFromCalibration: entry?.excludedFromCalibration ?? false,
    calibrationSkipReason: entry?.calibrationSkipReason ?? null,
    computedAt: nowMs,
    completion: completed ? buildCompletion(metrics, start, finish, nowMs) : null,
    issuesMissingOriginalEffort: metrics.issuesMissingOriginalEffort,
    assignedEffort: metrics.assignedEffort,
    unassignedEffort: metrics.unassignedEffort ?? ZERO_EFFORT,
    unresolvedIssueCount: metrics.unresolvedIssueCount,
  };
}
