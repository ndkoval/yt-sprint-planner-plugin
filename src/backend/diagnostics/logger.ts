/**
 * Sanitized diagnostic logging. See §19.
 *
 * Every log line carries a correlation id and safe context only. We NEVER log
 * tokens, cookies, passwords, full issue descriptions, or unrelated personal data.
 */

/** Fields that are always stripped from logged context, case-insensitive. */
const REDACT_KEYS = [
  'token',
  'authorization',
  'cookie',
  'password',
  'secret',
  'apikey',
  'api_key',
  'description',
];

/** Deeply redact sensitive keys from an arbitrary context object. */
export function sanitizeContext(context: unknown, depth = 0): unknown {
  if (depth > 6 || context === null || typeof context !== 'object') return context;
  if (Array.isArray(context)) return context.map((v) => sanitizeContext(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (REDACT_KEYS.includes(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeContext(value, depth + 1);
    }
  }
  return out;
}

/** Structured, sanitized log entry (§19). */
export interface LogEntry {
  correlationId: string;
  timestamp: number;
  operation: string;
  userId?: string;
  projectId?: string;
  sprintId?: string;
  context?: unknown;
}

export interface Logger {
  info(entry: LogEntry): void;
  error(entry: LogEntry & { errorMessage: string }): void;
}

/** A logger that writes sanitized JSON lines to a sink (defaults to console). */
export function createLogger(sink: (line: string) => void = (l) => console.error(l)): Logger {
  const format = (level: string, entry: LogEntry & { errorMessage?: string }): string => {
    const safe = {
      level,
      ...entry,
      context: entry.context === undefined ? undefined : sanitizeContext(entry.context),
    };
    return JSON.stringify(safe);
  };
  return {
    info: (entry) => sink(format('info', entry)),
    error: (entry) => sink(format('error', entry)),
  };
}
