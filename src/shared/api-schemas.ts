/**
 * Runtime validation schemas for backend request bodies. The backend validates every
 * mutating request against these before touching any state.
 */
import { z } from 'zod';
import {
  focusFactorSourceSchema,
  isoDateSchema,
  projectConfigSchema,
  sprintEntrySchema,
  userIdSchema,
} from './schemas.js';

const minutes = z.number().int().min(0);

export const putConfigRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    config: projectConfigSchema,
  })
  .strict();

export const registerSprintRequestSchema = z
  .object({
    sprint: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        start: isoDateSchema,
        finish: isoDateSchema,
      })
      .strict(),
    focusFactor: z.number().min(0).max(1).optional(),
    focusFactorSource: focusFactorSourceSchema.optional(),
  })
  .strict();

export const capacityWriteRequestSchema = z
  .object({
    sprintId: z.string().min(1),
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
    userId: userIdSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();

export const overrideFocusFactorRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    reason: z.string().min(1).max(2000),
    newValue: z.number().min(0).max(1),
  })
  .strict();

export const setCalibrationRequestSchema = z
  .object({
    sprintId: z.string().min(1),
    excluded: z.boolean(),
    reason: z.string().max(2000).optional(),
  })
  .strict()
  .refine((b) => !b.excluded || (b.reason ?? '').trim().length > 0, {
    message: 'a reason is required when excluding a Sprint from calibration',
  });

export const importRequestSchema = z
  .object({
    bundle: z
      .object({
        exportedAt: z.number().int(),
        configRevision: z.number().int().min(0),
        config: projectConfigSchema.nullable(),
        sprints: z.record(z.string(), sprintEntrySchema),
      })
      .strict(),
    dryRun: z.boolean(),
  })
  .strict();
