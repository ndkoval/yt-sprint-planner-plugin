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
  Team,
  TeamSprintEntry,
} from './types.js';
import { MAX_TEAMS } from './types.js';

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

export const teamSchema = z
  .object({
    id: z.string().min(1, 'a team id is required'),
    name: z.string().trim().min(1, 'a team name is required'),
    participants: z.array(participantSchema),
    // Optional per-team backlog OVERRIDE; empty/absent -> the project-level query.
    backlogQuery: z.string().optional(),
  })
  .strict();

export const projectConfigSchema = z
  .object({
    version: z.literal(3),
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
    teams: z
      .array(teamSchema)
      .min(1, 'at least one team is required')
      .max(MAX_TEAMS, `at most ${MAX_TEAMS} teams are supported`),
    // Per-project reminder override; 0 disables reminders for this project.
    reminderLeadDays: z.number().int().min(0).max(30).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    // Team ids and names must be unique; the same PERSON may be in several teams
    // (shared specialists) — their capacity is planned per team, and their issues
    // count toward every team they belong to. Within one team a login is unique.
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [i, team] of config.teams.entries()) {
      if (ids.has(team.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teams', i, 'id'],
          message: `duplicate team id "${team.id}"`,
        });
      }
      ids.add(team.id);
      const nameKey = team.name.trim().toLowerCase();
      if (names.has(nameKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teams', i, 'name'],
          message: `duplicate team name "${team.name}"`,
        });
      }
      names.add(nameKey);
      const logins = new Set<string>();
      for (const [j, p] of team.participants.entries()) {
        if (logins.has(p.userId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['teams', i, 'participants', j, 'userId'],
            message: `${p.userId} is already in this team`,
          });
        }
        logins.add(p.userId);
      }
    }
  });

export const focusFactorSourceSchema = z.enum([
  'bootstrap',
  'calculated',
  'manual',
  'carried-forward',
]);

export const configDocumentSchema = z
  .object({
    version: z.literal(3),
    revision: z.number().int().min(0),
    config: projectConfigSchema,
  })
  .strict();

export const teamSprintEntrySchema = z
  .object({
    capacityRevision: z.number().int().min(0),
    capacity: capacityDocumentSchema,
    focusFactor: z.number().min(0).max(1),
    focusFactorSource: focusFactorSourceSchema,
    focusFactorOverride: focusFactorOverrideSchema.nullable(),
    excludedFromCalibration: z.boolean(),
    calibrationSkipReason: z.string().nullable(),
  })
  .strict();

export const sprintEntrySchema = z
  .object({
    sequence: z.number().int().min(1),
    name: z.string(),
    start: isoDateSchema,
    finish: isoDateSchema,
    teams: z.record(z.string().min(1), teamSprintEntrySchema),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();

export const sprintDataDocumentSchema = z
  .object({
    version: z.literal(3),
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
  // Team's scalar fields are checked with participants omitted (nested-array optionals
  // defeat the top-level normaliser); participant elements are covered above.
  AssignableTo<Omit<z.infer<typeof teamSchema>, 'participants'>, Omit<Team, 'participants'>>,
  // Config's scalar fields are checked here; its nested `teams` elements are covered
  // by the team check above.
  AssignableTo<Omit<z.infer<typeof projectConfigSchema>, 'teams'>, Omit<ProjectConfig, 'teams'>>,
  AssignableTo<Omit<z.infer<typeof configDocumentSchema>, 'config'>, Omit<ConfigDocument, 'config'>>,
  AssignableTo<Omit<z.infer<typeof teamSprintEntrySchema>, 'capacity'>, Omit<TeamSprintEntry, 'capacity'>>,
  AssignableTo<Omit<z.infer<typeof sprintEntrySchema>, 'teams'>, Omit<SprintEntry, 'teams'>>,
  AssignableTo<Omit<z.infer<typeof sprintDataDocumentSchema>, 'sprints'>, Omit<SprintDataDocument, 'sprints'>>,
] = [true, true, true, true, true, true, true, true, true, true];
