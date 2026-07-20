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
  CompletionCalculation,
  FocusFactorOverride,
  IssueSnapshot,
  Participant,
  ProjectConfig,
} from './types.js';

/** Stable user id like "1-123". */
export const userIdSchema = z.string().regex(/^\d+-\d+$/, 'expected a YouTrack id like "1-123"');

/** Non-negative integer minutes. */
const minutes = z.number().int().min(0);

export const capacityRowSchema = z
  .object({
    userId: userIdSchema,
    loginSnapshot: z.string(),
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
    version: z.literal(1),
    createdFromConfigVersion: z.number().int().min(0),
    rows: z.record(userIdSchema, capacityRowSchema),
  })
  .strict();

export const completionCalculationSchema = z
  .object({
    version: z.literal(1),
    calculatedAt: z.number().int(),
    sprintStart: z.number().int(),
    sprintFinish: z.number().int(),
    rawCapacityMinutes: minutes,
    originalEffortMinutes: minutes,
    completedOriginalEffortMinutes: minutes,
    observedFocusFactor: z.number().min(0).nullable(),
    calculationRevision: z.number().int().min(0),
  })
  .strict();

export const issueSnapshotSchema = z
  .object({
    version: z.literal(1),
    managedSprintIds: z.array(z.string()),
    originalEffortMinutes: minutes,
    currentEffortMinutes: minutes,
    resolved: z.boolean(),
    resolvedAt: z.number().int().nullable(),
    updatedAt: z.number().int(),
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
    version: z.literal(1),
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
  AssignableTo<z.infer<typeof completionCalculationSchema>, CompletionCalculation>,
  AssignableTo<z.infer<typeof issueSnapshotSchema>, IssueSnapshot>,
  AssignableTo<z.infer<typeof focusFactorOverrideSchema>, FocusFactorOverride>,
  AssignableTo<z.infer<typeof participantSchema>, Participant>,
  // Config's scalar fields are checked here; its nested `participants` elements are
  // covered by the participant check above (nested-array optionals defeat the
  // top-level normaliser, so we compare the config with participants omitted).
  AssignableTo<Omit<z.infer<typeof projectConfigSchema>, 'participants'>, Omit<ProjectConfig, 'participants'>>,
] = [true, true, true, true, true, true, true];
