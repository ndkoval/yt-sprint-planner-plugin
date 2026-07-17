/**
 * Assembles the client-facing {@link SprintView} from a hydrated {@link SprintRecord}
 * and the currently-missing-effort issue list.
 */
import type { AssigneeEffortView, SprintView } from '../../shared/api.js';
import type { CapacityDocument } from '../../shared/types.js';
import type { SprintRecord } from '../repositories/sprint-repository.js';

const EMPTY_CAPACITY: CapacityDocument = { version: 1, createdFromConfigVersion: 0, rows: {} };
const ZERO_EFFORT: AssigneeEffortView = { originalEffortMinutes: 0, currentEffortMinutes: 0 };

/** Optional per-assignee breakdown; defaults to empty when a caller has no live issues. */
export interface AssignmentBreakdown {
  assignedEffort: Record<string, AssigneeEffortView>;
  unassignedEffort: AssigneeEffortView;
}

export function toSprintView(
  record: SprintRecord,
  issuesMissingOriginalEffort: string[],
  assignment: AssignmentBreakdown = { assignedEffort: {}, unassignedEffort: ZERO_EFFORT },
): SprintView {
  return {
    id: record.native.id,
    name: record.native.name,
    goal: record.native.goal,
    start: record.native.start ?? '',
    finish: record.native.finish ?? '',
    archived: record.native.archived,
    managed: record.managed,
    sequence: record.sequence,
    capacityRevision: record.capacityRevision,
    capacity: record.capacity ?? EMPTY_CAPACITY,
    focusFactor: record.focusFactor,
    focusFactorSource: record.focusFactorSource,
    focusFactorOverride: record.focusFactorOverride,
    rawCapacityMinutes: record.rawCapacityMinutes,
    confirmedCapacityMinutes: record.confirmedCapacityMinutes,
    plannedCapacityMinutes: record.plannedCapacityMinutes,
    originalEffortMinutes: record.originalEffortMinutes,
    currentEffortMinutes: record.currentEffortMinutes,
    completedOriginalEffortMinutes: record.completedOriginalEffortMinutes,
    observedFocusFactor: record.observedFocusFactor,
    excludedFromCalibration: record.excludedFromCalibration,
    calibrationSkipReason: record.calibrationSkipReason,
    metricsRevision: record.metricsRevision,
    metricsDirty: record.metricsDirty,
    dataIntegrityStatus: record.dataIntegrityStatus,
    lastWorkflowUpdateAt: record.lastWorkflowUpdateAt,
    lastRecalculatedAt: record.lastRecalculatedAt,
    completion: record.completion,
    issuesMissingOriginalEffort,
    assignedEffort: assignment.assignedEffort,
    unassignedEffort: assignment.unassignedEffort,
  };
}
