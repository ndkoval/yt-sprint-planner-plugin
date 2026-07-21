/**
 * Structured error type used across the backend. Every failed request serialises
 * to the {@link ApiError} envelope (§18/§19). Stack traces are never exposed.
 */
import { ZodError } from 'zod';
import type { ApiError, ApiErrorCode } from '../shared/api.js';

/** HTTP-equivalent status paired with each error code (kept for log readability). */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_CONFIGURED: 409,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CAPACITY_REVISION_CONFLICT: 409,
  CONFIG_REVISION_CONFLICT: 409,
  SPRINT_ALREADY_EXISTS: 409,
  INTERNAL_ERROR: 500,
};

/** A backend error that carries an API error code and safe, structured details. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toApiError(correlationId: string): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      correlationId,
    };
  }
}

/** Map a ZodError to a safe, structured validation problem list. */
function zodProblems(err: ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** HTTP status for an arbitrary error (validation ⇒ 400, AppError ⇒ its status, else 500). */
export function statusFor(err: unknown): number {
  if (err instanceof AppError) return err.status;
  if (err instanceof ZodError) return 400;
  return 500;
}

/**
 * Convert any thrown value into a safe {@link ApiError}. Request-body validation
 * failures (ZodError) become 400 VALIDATION_FAILED with a sanitized problem list;
 * unknown errors become INTERNAL_ERROR. Stack traces are never exposed.
 */
export function toApiError(err: unknown, correlationId: string): ApiError {
  if (err instanceof AppError) return err.toApiError(correlationId);
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'The request was invalid.',
      details: { problems: zodProblems(err) },
      correlationId,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    details: {},
    correlationId,
  };
}

// Convenience constructors for the common cases.
export const notConfigured = (): AppError =>
  new AppError('NOT_CONFIGURED', 'Board is not configured.');
export const forbidden = (message = 'You are not allowed to perform this action.'): AppError =>
  new AppError('FORBIDDEN', message);
export const notFound = (what: string): AppError =>
  new AppError('NOT_FOUND', `${what} was not found.`);
export const capacityConflict = (): AppError =>
  new AppError(
    'CAPACITY_REVISION_CONFLICT',
    'Your availability was changed by another user.',
  );
export const configConflict = (): AppError =>
  new AppError('CONFIG_REVISION_CONFLICT', 'Settings were changed by another user.');
