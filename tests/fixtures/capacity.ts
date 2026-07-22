/** Test fixtures/factories for capacity documents and v4 (per-team) sprint entries. */
import type {
  CapacityDocument,
  CapacityRow,
  Participant,
  Team,
  TeamSprint,
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

/**
 * Build a Team with one enabled full-time participant ("alice") by default.
 * Since config v4 the team carries its FULL planning configuration.
 */
export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Team 1',
    participants: [makeParticipant('alice')],
    boardId: 'board-1',
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'Sprint {sequence}',
    backlogQuery: '',
    learningRate: 0.5,
    ...overrides,
  };
}

/** Build one team's per-Sprint state (v4 {@link TeamSprint} — the whole entry). */
export function makeTeamSprint(overrides: Partial<TeamSprint> = {}): TeamSprint {
  return {
    sequence: 1,
    name: 'Sprint 1',
    start: '2026-01-05',
    finish: '2026-01-18',
    capacityRevision: 1,
    capacity: makeDoc([makeRow()]),
    focusFactor: 0.75,
    focusFactorSource: 'bootstrap',
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
