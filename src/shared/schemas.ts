/**
 * Runtime schemas (zod) for every persisted JSON document and API payload.
 *
 * These are the single source of truth for validation. TypeScript types in
 * {@link ./types.ts} are kept structurally compatible; `satisfies` checks below
 * fail the build if they drift.
 */
import { z } from 'zod';
import type {
  CapacityDocument,
  CapacityRow,
  ConfigDocument,
  FocusFactorOverride,
  Participant,
  ProjectConfig,
  SprintDataDocument,
  SprintEntry,
} from './types.js';

/** User login (non-empty). */
export const userIdSchema = z.string().min(1, 'a user login is required');

/** Non-negative integer minutes. */
const minutes = z.number().int().min(0);

/** yyyy-mm-dd. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

export const capacityRowSchema = z
  .object({
    userId: userIdSchema,
    displayNameSnapshot: z.string(),
    defaultMinutes: minutes,
    availableMinutes: minutes,
    availableWasCustomized: z.boolean(),
    note: z.string(),
    updatedAt: z.number().int(),
    updatedBy: userIdSchema,
  })
  .strict();

export const capacityDocumentSchema = z
  .object({
    version: z.literal(2),
    createdFromConfigVersion: z.number().int().min(0),
    rows: z.record(userIdSchema, capacityRowSchema),
  })
  .strict();

export const focusFactorOverrideSchema = z
  .object({
    reason: z.string().min(1, 'a reason is required'),
    oldValue: z.number(),
    newValue: z.number().min(0).max(1),
    userId: userIdSchema,
    timestamp: z.number().int(),
  })
  .strict();

export const participantSchema = z
  .object({
    userId: userIdSchema,
    enabled: z.boolean(),
    // Availability as a fraction of full-time. Full-time (1) by default so older configs
    // and simple setups need not specify it.
    allocation: z.number().gt(0).lte(1).default(1),
    note: z.string().optional(),
  })
  .strict();

export const projectConfigSchema = z
  .object({
    version: z.literal(2),
    boardId: z.string().min(1),
    originalEffortField: z.string().min(1),
    currentEffortField: z.string().min(1),
    hoursPerDay: z.number().positive(),
    sprintLengthDays: z.number().int().positive(),
    datePolicy: z.literal('continuous'),
    nameTemplate: z.string().min(1),
    // The backlog search query (may be empty to disable the backlog lane).
    backlogQuery: z.string().default(''),
    learningRate: z.number().gt(0).lte(1),
    participants: z.array(participantSchema),
    managersGroup: z.string().min(1).optional(),
  })
  .strict();

export const focusFactorSourceSchema = z.enum([
  'bootstrap',
  'calculated',
  'manual',
  'carried-forward',
]);

export const configDocumentSchema = z
  .object({
    version: z.literal(2),
    revision: z.number().int().min(0),
    config: projectConfigSchema,
  })
  .strict();

export const sprintEntrySchema = z
  .object({
    sequence: z.number().int().min(1),
    name: z.string(),
    start: isoDateSchema,
    finish: isoDateSchema,
    capacityRevision: z.number().int().min(0),
    capacity: capacityDocumentSchema,
    focusFactor: z.number().min(0).max(1),
    focusFactorSource: focusFactorSourceSchema,
    focusFactorOverride: focusFactorOverrideSchema.nullable(),
    excludedFromCalibration: z.boolean(),
    calibrationSkipReason: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();

export const sprintDataDocumentSchema = z
  .object({
    version: z.literal(2),
    sprints: z.record(z.string(), sprintEntrySchema),
  })
  .strict();

// Compile-time guarantee that each schema is assignable TO its hand-written type.
// `AssignableTo` normalises `prop?: T | undefined` (how zod infers optionals) against
// `prop?: T` (our types) so `exactOptionalPropertyTypes` doesn't create false drift,
// while still catching real field/type mismatches. If a schema drifts, the matching
// line below fails to compile.
type UndefinedToOptional<T> = { [K in keyof T]: Exclude<T[K], undefined> };
type AssignableTo<Schema, Target> =
  UndefinedToOptional<Schema> extends UndefinedToOptional<Target> ? true : never;

export const _typeChecks: [
  AssignableTo<z.infer<typeof capacityRowSchema>, CapacityRow>,
  AssignableTo<z.infer<typeof capacityDocumentSchema>, CapacityDocument>,
  AssignableTo<z.infer<typeof focusFactorOverrideSchema>, FocusFactorOverride>,
  AssignableTo<z.infer<typeof participantSchema>, Participant>,
  // Config's scalar fields are checked here; its nested `participants` elements are
  // covered by the participant check above (nested-array optionals defeat the
  // top-level normaliser, so we compare the config with participants omitted).
  AssignableTo<Omit<z.infer<typeof projectConfigSchema>, 'participants'>, Omit<ProjectConfig, 'participants'>>,
  AssignableTo<Omit<z.infer<typeof configDocumentSchema>, 'config'>, Omit<ConfigDocument, 'config'>>,
  AssignableTo<Omit<z.infer<typeof sprintEntrySchema>, 'capacity'>, Omit<SprintEntry, 'capacity'>>,
  AssignableTo<Omit<z.infer<typeof sprintDataDocumentSchema>, 'sprints'>, Omit<SprintDataDocument, 'sprints'>>,
] = [true, true, true, true, true, true, true, true];
