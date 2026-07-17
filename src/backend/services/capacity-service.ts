/**
 * Capacity row mutations with optimistic concurrency (§17) and server-side
 * authorization (§16). Only one row is changed per request; the revision is bumped
 * and the whole document returned so the client can refresh.
 */
import { canEditCapacityRow, type Principal } from '../../domain/index.js';
import type { CapacityDocument, CapacityRow, UserId } from '../../shared/types.js';
import type { Clock } from '../clock.js';
import { AppError, capacityConflict, forbidden, notFound } from '../errors.js';
import type { SprintRepository } from '../repositories/sprint-repository.js';

export interface CapacityPatch {
  availableMinutes?: number;
  confirmed?: boolean;
  note?: string;
}

export interface CapacityMutationResult {
  capacity: CapacityDocument;
  revision: number;
}

export class CapacityService {
  constructor(
    private readonly repo: SprintRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Apply a patch to one capacity row.
   *
   * @param sprintId        Target Sprint.
   * @param doc             Current capacity document (already loaded).
   * @param currentRevision Current capacity revision.
   * @param expectedRevision Client's expected revision (optimistic concurrency).
   * @param targetUserId    Row being edited.
   * @param principal       Caller.
   * @param patch           Fields to change.
   */
  async applyPatch(
    sprintId: string,
    doc: CapacityDocument,
    currentRevision: number,
    expectedRevision: number,
    targetUserId: UserId,
    principal: Principal,
    patch: CapacityPatch,
  ): Promise<CapacityMutationResult> {
    if (!canEditCapacityRow(principal, { targetUserId })) {
      throw forbidden('You can only edit your own availability.');
    }
    if (expectedRevision !== currentRevision) {
      throw capacityConflict();
    }
    const existing = doc.rows[targetUserId];
    if (!existing) {
      throw notFound(`Capacity row for user ${targetUserId}`);
    }
    if (patch.availableMinutes !== undefined && patch.availableMinutes < 0) {
      throw new AppError('VALIDATION_FAILED', 'Available capacity cannot be negative.');
    }

    const now = this.clock.now();
    const updated: CapacityRow = {
      ...existing,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    if (patch.availableMinutes !== undefined) {
      updated.availableMinutes = patch.availableMinutes;
      // Any explicit edit marks the row customised so date changes won't overwrite it.
      updated.availableWasCustomized = patch.availableMinutes !== existing.defaultMinutes;
    }
    if (patch.confirmed !== undefined) updated.confirmed = patch.confirmed;
    if (patch.note !== undefined) updated.note = patch.note;

    const newDoc: CapacityDocument = {
      ...doc,
      rows: { ...doc.rows, [targetUserId]: updated },
    };
    const newRevision = currentRevision + 1;
    await this.repo.saveCapacity(sprintId, newDoc, newRevision);
    return { capacity: newDoc, revision: newRevision };
  }

  /** Reset a row's available capacity back to its default and clear customisation. */
  async resetRow(
    sprintId: string,
    doc: CapacityDocument,
    currentRevision: number,
    expectedRevision: number,
    targetUserId: UserId,
    principal: Principal,
  ): Promise<CapacityMutationResult> {
    if (!canEditCapacityRow(principal, { targetUserId })) {
      throw forbidden('You can only reset your own availability.');
    }
    if (expectedRevision !== currentRevision) {
      throw capacityConflict();
    }
    const existing = doc.rows[targetUserId];
    if (!existing) throw notFound(`Capacity row for user ${targetUserId}`);

    const now = this.clock.now();
    const updated: CapacityRow = {
      ...existing,
      availableMinutes: existing.defaultMinutes,
      availableWasCustomized: false,
      updatedAt: now,
      updatedBy: principal.userId,
    };
    const newDoc: CapacityDocument = { ...doc, rows: { ...doc.rows, [targetUserId]: updated } };
    const newRevision = currentRevision + 1;
    await this.repo.saveCapacity(sprintId, newDoc, newRevision);
    return { capacity: newDoc, revision: newRevision };
  }
}
