/**
 * Export / import (§20.3–20.4). Export produces a versioned JSON bundle of config +
 * managed-Sprint metadata + capacity + focus factors + aggregates + completion +
 * schema versions. Import validates the bundle, supports a dry run and a conflict
 * report, and never creates duplicate native Sprints by default.
 */
import { z } from 'zod';
import {
  capacityDocumentSchema,
  completionCalculationSchema,
  projectConfigSchema,
} from '../../shared/schemas.js';
import type { ConfigRepository } from '../repositories/config-repository.js';
import type { SprintRepository } from '../repositories/sprint-repository.js';

export const EXPORT_VERSION = 1;

const exportedSprintSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    start: z.string().nullable(),
    finish: z.string().nullable(),
    sequence: z.number().int(),
    focusFactor: z.number(),
    focusFactorSource: z.string(),
    rawCapacityMinutes: z.number().int(),
    originalEffortMinutes: z.number().int(),
    currentEffortMinutes: z.number().int(),
    completedOriginalEffortMinutes: z.number().int(),
    observedFocusFactor: z.number().nullable(),
    excludedFromCalibration: z.boolean(),
    capacity: capacityDocumentSchema.nullable(),
    completion: completionCalculationSchema.nullable(),
  })
  .strict();

export const exportBundleSchema = z
  .object({
    exportVersion: z.literal(EXPORT_VERSION),
    exportedAt: z.number().int(),
    projectId: z.string(),
    config: projectConfigSchema.nullable(),
    configRevision: z.number().int(),
    sprints: z.array(exportedSprintSchema),
  })
  .strict();

export type ExportBundle = z.infer<typeof exportBundleSchema>;

export interface ImportConflict {
  sprintId: string;
  reason: string;
}

export interface ImportResult {
  dryRun: boolean;
  applied: boolean;
  conflicts: ImportConflict[];
  importedSprintCount: number;
}

export class ExportImportService {
  constructor(
    private readonly configRepo: ConfigRepository,
    private readonly sprintRepo: SprintRepository,
    private readonly projectId: string,
  ) {}

  async exportBundle(exportedAt: number): Promise<ExportBundle> {
    const config = await this.configRepo.load();
    const managed = await this.sprintRepo.loadAllManaged(this.projectId);
    return {
      exportVersion: EXPORT_VERSION,
      exportedAt,
      projectId: this.projectId,
      config: config.config,
      configRevision: config.revision,
      sprints: managed.map((r) => ({
        id: r.native.id,
        name: r.native.name,
        start: r.native.start,
        finish: r.native.finish,
        sequence: r.sequence,
        focusFactor: r.focusFactor,
        focusFactorSource: r.focusFactorSource,
        rawCapacityMinutes: r.rawCapacityMinutes,
        originalEffortMinutes: r.originalEffortMinutes,
        currentEffortMinutes: r.currentEffortMinutes,
        completedOriginalEffortMinutes: r.completedOriginalEffortMinutes,
        observedFocusFactor: r.observedFocusFactor,
        excludedFromCalibration: r.excludedFromCalibration,
        capacity: r.capacity,
        completion: r.completion,
      })),
    };
  }

  /**
   * Import a bundle. Validates the schema, then (unless dryRun) writes config +
   * per-Sprint capacity/factors for Sprints that already exist by id. Sprints in the
   * bundle that do not exist in the project are reported as conflicts and NOT created
   * (no duplicate native Sprints by default — §20.4).
   */
  async importBundle(raw: unknown, dryRun: boolean): Promise<ImportResult> {
    const bundle = exportBundleSchema.parse(raw);
    const conflicts: ImportConflict[] = [];
    const existing = await this.sprintRepo.loadAllManaged(this.projectId);
    const existingIds = new Set(existing.map((r) => r.native.id));

    for (const s of bundle.sprints) {
      if (!existingIds.has(s.id)) {
        conflicts.push({ sprintId: s.id, reason: 'No matching native Sprint in this project.' });
      }
    }

    if (dryRun) {
      return { dryRun: true, applied: false, conflicts, importedSprintCount: 0 };
    }

    if (bundle.config) {
      const current = await this.configRepo.load();
      await this.configRepo.save(bundle.config, current.revision + 1);
    }

    let imported = 0;
    for (const s of bundle.sprints) {
      if (!existingIds.has(s.id)) continue;
      if (s.capacity) {
        await this.sprintRepo.saveCapacity(s.id, s.capacity, 1);
      }
      imported += 1;
    }

    return { dryRun: false, applied: true, conflicts, importedSprintCount: imported };
  }
}
