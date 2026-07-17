/**
 * Native Sprint CRUD and the one-click "Create next Sprint" flow (§14).
 *
 * The native Sprint is the only Sprint object and the only source of truth for
 * membership (§3.1). name/start/finish are set via REST (they are read-only in the
 * Workflow API). Creation is idempotent (§14.3): a create operation id and
 * name/date duplicate checks let a retried, partially-completed operation resume
 * instead of creating a duplicate Sprint.
 */
import {
  firstSprintDates,
  isDuplicateName,
  nextSequence,
  nextSprintDates,
  renderSprintName,
} from '../../domain/index.js';
import type { ProjectConfig } from '../../shared/types.js';
import type { Clock } from '../clock.js';
import { AppError, notConfigured } from '../errors.js';
import { newOperationId } from '../ids.js';
import type { SprintRecord, SprintRepository } from '../repositories/sprint-repository.js';
import type { YouTrackClient, YtSprint } from '../repositories/youtrack-client.js';
import { seedCapacityDocument } from './capacity-init.js';
import { computeNextFocusFactor } from './focus-factor-service.js';
import { ReconciliationService } from './reconciliation-service.js';

export interface CreateNextResult {
  sprint: YtSprint;
  sequence: number;
  resumed: boolean;
}

export class SprintService {
  constructor(
    private readonly client: YouTrackClient,
    private readonly repo: SprintRepository,
    private readonly reconciliation: ReconciliationService,
    private readonly clock: Clock,
  ) {}

  /**
   * Create the next Sprint. Steps mirror §14.2; each is safe to re-run.
   *
   * @param config       Validated project config.
   * @param boardId      Board to create on.
   * @param projectId    Owning project.
   * @param goal         Optional goal text.
   * @param moveUnresolved Move unresolved issues from the previous Sprint.
   */
  async createNext(
    config: ProjectConfig,
    boardId: string,
    projectId: string,
    goal: string,
    moveUnresolved: boolean,
  ): Promise<CreateNextResult> {
    // 1. Settings must be present.
    if (!config) throw notConfigured();

    // 2–3. Load managed Sprints; find the latest by sequence.
    const managed = await this.repo.loadAllManaged(projectId);
    const previous = latestBySequence(managed);

    // 5–6. Recalculate the previous Sprint so its completion/observed factor is fresh.
    if (previous) {
      await this.reconciliation.reconcile(previous, config, boardId, null);
    }
    const managedAfter = await this.repo.loadAllManaged(projectId);

    // 7. Next dates.
    const dates = previous?.native.finish
      ? nextSprintDates(previous.native.finish, config.sprintLengthDays)
      : firstSprintDates(config.firstSprintStart, config.sprintLengthDays);

    // 8–9. Sequence + name.
    const sequence = nextSequence(managedAfter.map((r) => r.sequence));
    const year = Number(dates.start.slice(0, 4));
    const name = renderSprintName(config.nameTemplate, {
      year,
      sequence,
      startDate: dates.start,
      finishDate: dates.finish,
    });

    // 12. Duplicate checks — resume if an identical Sprint already exists.
    const existingNames = managedAfter.map((r) => r.native.name);
    const duplicate = managedAfter.find(
      (r) => r.native.start === dates.start && r.native.finish === dates.finish,
    );
    if (duplicate) {
      return { sprint: duplicate.native, sequence: duplicate.sequence, resumed: true };
    }
    if (isDuplicateName(name, existingNames)) {
      throw new AppError('SPRINT_ALREADY_EXISTS', `A Sprint named "${name}" already exists.`, {
        name,
      });
    }

    // 10–11. Next Focus Factor + operation id.
    const factor = computeNextFocusFactor(managedAfter, config, this.clock.now());
    const operationId = newOperationId(this.clock.now());

    // 13. Create the native Sprint via REST.
    const created = await this.client.createSprint({
      boardId,
      name,
      goal,
      start: dates.start,
      finish: dates.finish,
    });

    // 14. Initialise app-owned properties.
    await this.repo.initialiseProperties(
      created.id,
      projectId,
      sequence,
      operationId,
      factor.value,
      factor.source,
    );

    // 15. Seed capacity rows from the current team config.
    const userIds = config.participants.filter((p) => p.enabled).map((p) => p.userId);
    const users = await this.client.getUsers(userIds);
    const capacity = seedCapacityDocument(config, users, dates.start, dates.finish, this.clock.now());
    await this.repo.saveCapacity(created.id, capacity, 1);

    // Optionally move unresolved issues from the previous Sprint.
    if (moveUnresolved && previous) {
      await this.client.moveUnresolvedIssues(boardId, previous.native.id, created.id);
    }

    // 16. Reconcile the new Sprint so its metrics are authoritative from the start.
    const record = await this.repo.load(created, projectId);
    await this.reconciliation.reconcile(record, config, boardId, null);

    return { sprint: created, sequence, resumed: false };
  }

  /** Patch native Sprint details (§6.2). Validates ordering and non-empty name. */
  async patchDetails(
    boardId: string,
    sprintId: string,
    patch: {
      name?: string | undefined;
      goal?: string | undefined;
      start?: string | undefined;
      finish?: string | undefined;
    },
    current: YtSprint,
  ): Promise<YtSprint> {
    const start = patch.start ?? current.start;
    const finish = patch.finish ?? current.finish;
    if (patch.name !== undefined && patch.name.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Sprint name is required.');
    }
    if (start && finish && finish <= start) {
      throw new AppError('VALIDATION_FAILED', 'Finish must be after start.');
    }
    return this.client.updateSprint(boardId, sprintId, patch);
  }
}

/** The managed Sprint with the highest sequence, or null. */
function latestBySequence(managed: readonly SprintRecord[]): SprintRecord | null {
  if (managed.length === 0) return null;
  return managed.reduce((latest, r) => (r.sequence > latest.sequence ? r : latest));
}
