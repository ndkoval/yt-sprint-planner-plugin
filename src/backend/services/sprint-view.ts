/**
 * Assembles the client-facing {@link SprintView} from a hydrated {@link SprintRecord}
 * and the currently-missing-effort issue list.
 */
import type { SprintView } from '../../shared/api.js';
import type { CapacityDocument } from '../../shared/types.js';
import type { SprintRecord } from '../repositories/sprint-repository.js';

const EMPTY_CAPACITY: CapacityDocument = { version: 1, createdFromConfigVersion: 0, rows: {} };

export function toSprintView(
  record: SprintRecord,
  issuesMissingOriginalEffort: string[],
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
  };
}
