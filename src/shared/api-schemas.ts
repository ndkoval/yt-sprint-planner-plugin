/**
 * Runtime validation schemas for mutating API request bodies (§18: "All payloads
 * pass runtime schema validation"). The backend validates every request against
 * these before touching any state.
 */
import { z } from 'zod';
import { projectConfigSchema } from './schemas.js';

const minutes = z.number().int().min(0);

export const putConfigRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    config: projectConfigSchema,
  })
  .strict();

export const patchCapacityRequestSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    availableMinutes: minutes.optional(),
    confirmed: z.boolean().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.availableMinutes !== undefined || b.confirmed !== undefined || b.note !== undefined,
    { message: 'at least one of availableMinutes, confirmed, note is required' },
  );

export const createNextSprintRequestSchema = z
  .object({
    goal: z.string().max(4000).optional(),
    moveUnresolvedIssues: z.boolean(),
  })
  .strict();

export const patchSprintDetailsRequestSchema = z
  .object({
    name: z.string().min(1).max(500).optional(),
    goal: z.string().max(4000).optional(),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    finish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });

export const overrideFocusFactorRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000),
    newValue: z.number().min(0).max(1),
  })
  .strict();

export const excludeCalibrationRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .strict();
