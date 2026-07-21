/** Test fixtures/factories for capacity documents. */
import type { CapacityDocument, CapacityRow } from '../../src/shared/types.js';

/** Build a CapacityRow with sensible defaults, overridable per test. */
export function makeRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    userId: 'alice',
    displayNameSnapshot: 'Display Name',
    defaultMinutes: 4800,
    availableMinutes: 4800,
    availableWasCustomized: false,
    note: '',
    updatedAt: 0,
    updatedBy: 'alice',
    ...overrides,
  };
}

/** Build a CapacityDocument from a list of rows, keyed by userId (login). */
export function makeDoc(rows: CapacityRow[]): CapacityDocument {
  const byId: Record<string, CapacityRow> = {};
  for (const row of rows) byId[row.userId] = row;
  return { version: 2, createdFromConfigVersion: 1, rows: byId };
}
