/**
 * Authoritative reconciliation (§13). The incremental workflow cache is not the
 * absolute source of truth; this service fetches the full current issue set for a
 * Sprint, fully recomputes every metric, corrects the cache, and marks the Sprint
 * up-to-date. It runs after Sprint creation, after date changes, before next-Sprint
 * creation, when a dirty Sprint is opened, on the Recalculate button, and on schedule.
 */
import type { ProjectConfig } from '../../shared/types.js';
import type { Clock } from '../clock.js';
import type { SprintRecord, SprintRepository } from '../repositories/sprint-repository.js';
import type { YouTrackClient } from '../repositories/youtrack-client.js';
import { buildCompletion, computeMetrics, type ComputedMetrics } from './metrics-service.js';

export interface ReconcileResult {
  sprintId: string;
  metrics: ComputedMetrics;
  /** True if any cached value differed from the recomputed value. */
  correctedCache: boolean;
  completed: boolean;
}

export class ReconciliationService {
  constructor(
    private readonly client: YouTrackClient,
    private readonly repo: SprintRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Fully recompute and persist one Sprint's metrics.
   *
   * @param record       The hydrated Sprint record.
   * @param config       Project config (for effort field names + hours/day).
   * @param boardId      Board the Sprint belongs to.
   * @param recalculatedBy User id triggering the recalculation, or null (scheduled).
   */
  async reconcile(
    record: SprintRecord,
    config: ProjectConfig,
    boardId: string,
    recalculatedBy: string | null,
  ): Promise<ReconcileResult> {
    const { native } = record;
    if (!native.start || !native.finish) {
      // Cannot compute effort windows without dates; leave dirty and report.
      return {
        sprintId: native.id,
        metrics: emptyMetrics(),
        correctedCache: false,
        completed: false,
      };
    }

    const issues = await this.client.getSprintIssues(
      boardId,
      native.id,
      config.originalEffortField,
      config.currentEffortField,
    );
    const metrics = computeMetrics(
      record.capacity,
      issues,
      native.start,
      native.finish,
      record.focusFactor,
    );

    const now = this.clock.now();
    const completed = isCompleted(native.finish, now);
    const completion = completed
      ? buildCompletion(metrics, native.start, native.finish, now, record.metricsRevision + 1)
      : null;

    const correctedCache =
      metrics.rawCapacityMinutes !== record.rawCapacityMinutes ||
      metrics.originalEffortMinutes !== record.originalEffortMinutes ||
      metrics.currentEffortMinutes !== record.currentEffortMinutes ||
      metrics.completedOriginalEffortMinutes !== record.completedOriginalEffortMinutes;

    await this.repo.saveMetrics(native.id, {
      rawCapacityMinutes: metrics.rawCapacityMinutes,
      plannedCapacityMinutes: metrics.plannedCapacityMinutes,
      originalEffortMinutes: metrics.originalEffortMinutes,
      currentEffortMinutes: metrics.currentEffortMinutes,
      completedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
      observedFocusFactor: metrics.observedFocusFactor,
      metricsRevision: record.metricsRevision + 1,
      status: 'up-to-date',
      recalculatedAt: now,
      recalculatedBy,
      completion,
    });

    return { sprintId: native.id, metrics, correctedCache, completed };
  }

  /** Reconcile every managed Sprint currently marked dirty (scheduled path). */
  async reconcileDirty(config: ProjectConfig, boardId: string, projectId: string): Promise<ReconcileResult[]> {
    const managed = await this.repo.loadAllManaged(projectId);
    const dirty = managed.filter((r) => r.metricsDirty || r.dataIntegrityStatus !== 'up-to-date');
    const results: ReconcileResult[] = [];
    for (const record of dirty) {
      results.push(await this.reconcile(record, config, boardId, null));
    }
    return results;
  }
}

/** A Sprint is "completed" once its finish date has passed (§15). */
export function isCompleted(finish: string, nowMs: number): boolean {
  // finish is inclusive; the Sprint is complete after the end of the finish day.
  const finishEndMs = Date.UTC(
    Number(finish.slice(0, 4)),
    Number(finish.slice(5, 7)) - 1,
    Number(finish.slice(8, 10)),
    23,
    59,
    59,
    999,
  );
  return nowMs > finishEndMs;
}

function emptyMetrics(): ComputedMetrics {
  return {
    rawCapacityMinutes: 0,
    plannedCapacityMinutes: 0,
    originalEffortMinutes: 0,
    currentEffortMinutes: 0,
    completedOriginalEffortMinutes: 0,
    observedFocusFactor: null,
    issuesMissingOriginalEffort: [],
    assignedEffort: {},
    unassignedEffort: { originalEffortMinutes: 0, currentEffortMinutes: 0 },
  };
}
