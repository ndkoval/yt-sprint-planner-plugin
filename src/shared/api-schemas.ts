/**
 * Runtime validation schemas for backend request bodies. The backend validates every
 * mutating request against these before touching any state.
 */
import { z } from 'zod';
import {
  focusFactorSourceSchema,
  isoDateSchema,
  projectConfigSchema,
  userIdSchema,
} from './schemas.js';

const minutes = z.number().int().min(0);

export const putConfigRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    config: projectConfigSchema,
  })
  .strict();

/** Optional team discriminator (resolves to the only team when omitted). */
const teamId = z.string().min(1).optional();

export const registerSprintRequestSchema = z
  .object({
    teamId,
    sprint: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        start: isoDateSchema,
        finish: isoDateSchema,
      })
      .strict(),
    seed: z
      .object({
        focusFactor: z.number().min(0).max(1),
        focusFactorSource: focusFactorSourceSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const capacityWriteRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    teamId,
    target: z.union([z.literal('me'), z.object({ userId: userIdSchema }).strict()]),
    expectedRevision: z.number().int().min(0),
    availableMinutes: minutes.optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine((b) => b.availableMinutes !== undefined || b.note !== undefined, {
    message: 'at least one of availableMinutes, note is required',
  });

export const capacityResetRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    teamId,
    userId: userIdSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export const overrideFocusFactorRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    teamId,
    reason: z.string().min(1).max(2000),
    newValue: z.number().min(0).max(1),
  })
  .strict();

export const setCalibrationRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    teamId,
    excluded: z.boolean(),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine((b) => !b.excluded || (b.reason ?? '').trim().length > 0, {
    message: 'a reason is required when excluding a Sprint from calibration',
  });

export const savePrefsRequestSchema = z
  .object({
    lastProjectKey: z.string().min(1).max(100).nullable().optional(),
    lastTeam: z
      .object({
        projectKey: z.string().min(1).max(100),
        teamId: z.string().min(1).max(100).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((b) => b.lastProjectKey !== undefined || b.lastTeam !== undefined, {
    message: 'at least one of lastProjectKey, lastTeam is required',
  });

/**
 * Import envelope. The bundle's documents are validated only structurally here —
 * the handler migrates them from any supported schema era (v4 bundles carry
 * `teams`, older exports carry `sprints`; a pre-teams v0.2.0 export must stay
 * restorable) and then strict-validates the result.
 */
export const importRequestSchema = z
  .object({
    bundle: z
      .object({
        exportedAt: z.number().int(),
        configRevision: z.number().int().min(0),
        config: z.unknown(),
        sprints: z.unknown(),
        teams: z.unknown(),
      })
      .strict(),
    dryRun: z.boolean(),
  })
  .strict();
