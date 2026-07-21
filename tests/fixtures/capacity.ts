/** Test fixtures/factories for capacity documents and v3 (teams) sprint entries. */
import type {
  CapacityDocument,
  CapacityRow,
  Participant,
  SprintEntry,
  Team,
  TeamSprintEntry,
} from '../../src/shared/types.js';

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

/** Build a full-time enabled Participant. */
export function makeParticipant(userId: string, overrides: Partial<Participant> = {}): Participant {
  return { userId, enabled: true, allocation: 1, ...overrides };
}

/** Build a Team with one enabled full-time participant ("alice") by default. */
export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Team 1',
    participants: [makeParticipant('alice')],
    ...overrides,
  };
}

/** Build one team's per-Sprint planning state (v3 {@link TeamSprintEntry}). */
export function makeTeamEntry(overrides: Partial<TeamSprintEntry> = {}): TeamSprintEntry {
  return {
    capacityRevision: 1,
    capacity: makeDoc([makeRow()]),
    focusFactor: 0.75,
    focusFactorSource: 'bootstrap',
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
    ...overrides,
  };
}

/** Build a v3 SprintEntry with one default team entry under "team-1". */
export function makeSprintEntry(overrides: Partial<SprintEntry> = {}): SprintEntry {
  return {
    sequence: 1,
    name: 'Sprint 1',
    start: '2026-01-05',
    finish: '2026-01-18',
    teams: { 'team-1': makeTeamEntry() },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
