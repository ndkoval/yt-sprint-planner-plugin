/**
 * Correlation and operation id generation.
 *
 * A time+counter+random scheme avoids collisions without needing crypto. Ids are
 * opaque strings used only for tracing and idempotency; they are not secrets.
 */
let counter = 0;

function randomSuffix(): string {
  // 8 hex chars of non-cryptographic randomness — collision resistance is enough
  // for tracing/idempotency, and this avoids a crypto dependency in the YT runtime.
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
}

/** A correlation id for one request, e.g. "cid-1784-3f2a1b0c-0". */
export function newCorrelationId(now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `cid-${now.toString(36)}-${randomSuffix()}-${counter}`;
}

/** An idempotent operation id for next-Sprint creation. */
export function newOperationId(now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `op-${now.toString(36)}-${randomSuffix()}-${counter}`;
}
