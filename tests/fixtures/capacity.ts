/** Test fixtures/factories for capacity documents. */
import type { CapacityDocument, CapacityRow } from '../../src/shared/types.js';

/** Build a CapacityRow with sensible defaults, overridable per test. */
export function makeRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    userId: '1-1',
    loginSnapshot: 'login',
    displayNameSnapshot: 'Display Name',
    defaultMinutes: 4800,
    availableMinutes: 4800,
    availableWasCustomized: false,
    confirmed: false,
    note: '',
    updatedAt: 0,
    updatedBy: '1-1',
    ...overrides,
  };
}

/** Build a CapacityDocument from a list of rows, keyed by userId. */
export function makeDoc(rows: CapacityRow[]): CapacityDocument {
  const byId: Record<string, CapacityRow> = {};
  for (const row of rows) byId[row.userId] = row;
  return { version: 1, createdFromConfigVersion: 1, rows: byId };
}
