/**
 * Manager-only diagnostics (§18 GET /diagnostics). Summarises managed-Sprint health
 * without exposing sensitive data.
 */
import type { DiagnosticsResponse } from '../../shared/api.js';
import type { SprintRepository } from '../repositories/sprint-repository.js';

export class DiagnosticsService {
  constructor(private readonly repo: SprintRepository) {}

  async summary(projectId: string, correlationId: string): Promise<DiagnosticsResponse> {
    const managed = await this.repo.loadAllManaged(projectId);
    const dirty = managed.filter((r) => r.metricsDirty || r.dataIntegrityStatus !== 'up-to-date');
    const lastReconciliationAt = managed.reduce<number | null>((max, r) => {
      if (r.lastRecalculatedAt === null) return max;
      return max === null ? r.lastRecalculatedAt : Math.max(max, r.lastRecalculatedAt);
    }, null);
    return {
      correlationId,
      managedSprintCount: managed.length,
      dirtySprintIds: dirty.map((r) => r.native.id),
      lastReconciliationAt,
      problems: dirty.map((r) => ({
        sprintId: r.native.id,
        status: r.dataIntegrityStatus,
        detail: r.dataIntegrityStatus === 'error' ? 'Workflow incremental update failed.' : 'Metrics require recalculation.',
      })),
    };
  }
}
