import { describe, it, expect } from 'vitest';
import {
  userIdSchema,
  capacityRowSchema,
  capacityDocumentSchema,
  configDocumentSchema,
  focusFactorOverrideSchema,
  participantSchema,
  projectConfigSchema,
  teamSchema,
  sprintEntrySchema,
  sprintDataDocumentSchema,
} from '../../src/shared/schemas.js';

const validRow = {
  userId: 'alice',
  displayNameSnapshot: 'Alice',
  defaultMinutes: 4800,
  availableMinutes: 4800,
  availableWasCustomized: false,
  note: '',
  updatedAt: 0,
  updatedBy: 'alice',
};

const validDoc = {
  version: 2,
  createdFromConfigVersion: 1,
  rows: { alice: validRow },
};

const team = (id: string, name: string, logins: string[]) => ({
  id,
  name,
  participants: logins.map((userId) => ({ userId, enabled: true, allocation: 1 })),
});

const validConfig = {
  version: 3,
  boardId: 'board-1',
  originalEffortField: 'Original estimation',
  currentEffortField: 'Estimation',
  hoursPerDay: 8,
  sprintLengthDays: 14,
  datePolicy: 'continuous',
  nameTemplate: 'Sprint {sequence}',
  backlogQuery: '',
  learningRate: 0.2,
  teams: [team('team-1', 'Team 1', ['alice'])],
};

const validTeamEntry = {
  capacityRevision: 1,
  capacity: validDoc,
  focusFactor: 0.75,
  focusFactorSource: 'bootstrap',
  focusFactorOverride: null,
  excludedFromCalibration: false,
  calibrationSkipReason: null,
};

const validEntry = {
  sequence: 1,
  name: 'Sprint 1',
  start: '2026-01-01',
  finish: '2026-01-14',
  teams: { 'team-1': validTeamEntry },
  createdAt: 1,
  updatedAt: 1,
};

describe('userIdSchema', () => {
  it('accepts a login', () => {
    expect(userIdSchema.safeParse('alice').success).toBe(true);
  });

  it('rejects an empty login', () => {
    expect(userIdSchema.safeParse('').success).toBe(false);
  });
});

describe('capacityRowSchema', () => {
  it('accepts a valid row', () => {
    expect(capacityRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects an empty user id', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, userId: '' }).success).toBe(false);
  });

  it('rejects negative minutes', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, availableMinutes: -1 }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { note: _note, ...withoutNote } = validRow;
    expect(capacityRowSchema.safeParse(withoutNote).success).toBe(false);
  });

  it('rejects extra fields via .strict()', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, extra: 1 }).success).toBe(false);
  });
});

describe('capacityDocumentSchema', () => {
  it('accepts a valid document (capacity docs stayed at version 2 in the v3 model)', () => {
    expect(capacityDocumentSchema.safeParse(validDoc).success).toBe(true);
  });

  it('rejects a wrong version literal', () => {
    expect(capacityDocumentSchema.safeParse({ ...validDoc, version: 1 }).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(capacityDocumentSchema.safeParse({ ...validDoc, extra: 1 }).success).toBe(false);
  });
});

describe('focusFactorOverrideSchema', () => {
  const valid = { reason: 'holiday', oldValue: 0.7, newValue: 0.5, userId: 'alice', timestamp: 1 };

  it('accepts a valid override', () => {
    expect(focusFactorOverrideSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty reason', () => {
    expect(focusFactorOverrideSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
  });

  it('rejects a newValue outside [0, 1]', () => {
    expect(focusFactorOverrideSchema.safeParse({ ...valid, newValue: 1.5 }).success).toBe(false);
  });
});

describe('participantSchema', () => {
  it('accepts a valid participant, defaulting allocation to full-time', () => {
    const parsed = participantSchema.parse({ userId: 'alice', enabled: true });
    expect(parsed.allocation).toBe(1);
    expect(
      participantSchema.safeParse({ userId: 'alice', enabled: false, note: 'x', allocation: 0.5 })
        .success,
    ).toBe(true);
  });

  it('rejects an out-of-range allocation', () => {
    expect(participantSchema.safeParse({ userId: 'alice', enabled: true, allocation: 0 }).success).toBe(
      false,
    );
    expect(
      participantSchema.safeParse({ userId: 'alice', enabled: true, allocation: 1.5 }).success,
    ).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(participantSchema.safeParse({ userId: 'alice', enabled: true, bogus: 1 }).success).toBe(
      false,
    );
  });
});

describe('teamSchema', () => {
  it('accepts a team with an optional backlog override', () => {
    expect(teamSchema.safeParse(team('team-1', 'Alpha', ['alice'])).success).toBe(true);
    expect(
      teamSchema.safeParse({ ...team('team-1', 'Alpha', ['alice']), backlogQuery: '#Unresolved' })
        .success,
    ).toBe(true);
  });

  it('rejects empty ids and blank names', () => {
    expect(teamSchema.safeParse(team('', 'Alpha', [])).success).toBe(false);
    expect(teamSchema.safeParse(team('team-1', '   ', [])).success).toBe(false);
  });
});

describe('projectConfigSchema', () => {
  it('accepts a valid v3 config', () => {
    expect(projectConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it('accepts several disjoint teams', () => {
    const config = {
      ...validConfig,
      teams: [team('team-1', 'Alpha', ['alice']), team('team-2', 'Beta', ['bob'])],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(true);
  });

  it('rejects duplicate team ids', () => {
    const config = {
      ...validConfig,
      teams: [team('team-1', 'Alpha', ['alice']), team('team-1', 'Beta', ['bob'])],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects duplicate team names case-insensitively', () => {
    const config = {
      ...validConfig,
      teams: [team('team-1', 'Alpha', ['alice']), team('team-2', ' ALPHA ', ['bob'])],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(false);
  });

  it('ACCEPTS the same login in two different teams (shared specialist)', () => {
    const config = {
      ...validConfig,
      teams: [team('team-1', 'Alpha', ['alice', 'bob']), team('team-2', 'Beta', ['alice'])],
    };
    expect(projectConfigSchema.safeParse(config).success).toBe(true);
  });

  it('rejects a duplicate login WITHIN one team', () => {
    const config = {
      ...validConfig,
      teams: [team('team-1', 'Alpha', ['alice', 'alice'])],
    };
    const result = projectConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /already in this team/.test(i.message))).toBe(true);
    }
  });

  it('rejects zero teams', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, teams: [] }).success).toBe(false);
  });

  it('rejects more than 20 teams', () => {
    const teams = Array.from({ length: 21 }, (_, i) => team(`team-${i + 1}`, `Team ${i + 1}`, []));
    expect(projectConfigSchema.safeParse({ ...validConfig, teams }).success).toBe(false);
    expect(
      projectConfigSchema.safeParse({ ...validConfig, teams: teams.slice(0, 20) }).success,
    ).toBe(true);
  });

  it('accepts reminderLeadDays in 0..30 and rejects values outside', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, reminderLeadDays: 0 }).success).toBe(true);
    expect(projectConfigSchema.safeParse({ ...validConfig, reminderLeadDays: 30 }).success).toBe(true);
    expect(projectConfigSchema.safeParse({ ...validConfig, reminderLeadDays: -1 }).success).toBe(false);
    expect(projectConfigSchema.safeParse({ ...validConfig, reminderLeadDays: 31 }).success).toBe(false);
    expect(projectConfigSchema.safeParse({ ...validConfig, reminderLeadDays: 2.5 }).success).toBe(false);
  });

  it('rejects a non-positive hoursPerDay', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, hoursPerDay: 0 }).success).toBe(false);
  });

  it('rejects a non-integer sprintLengthDays', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, sprintLengthDays: 2.5 }).success).toBe(
      false,
    );
  });

  it('rejects a learning rate outside (0, 1]', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, learningRate: 0 }).success).toBe(false);
    expect(projectConfigSchema.safeParse({ ...validConfig, learningRate: 1.5 }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { boardId: _b, ...rest } = validConfig;
    expect(projectConfigSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects the removed managersGroup field (no app permission scheme in v3)', () => {
    expect(
      projectConfigSchema.safeParse({ ...validConfig, managersGroup: 'Capacity Managers' })
        .success,
    ).toBe(false);
  });

  it('rejects the pre-teams flat participants list (moved into teams in v3)', () => {
    expect(
      projectConfigSchema.safeParse({
        ...validConfig,
        participants: [{ userId: 'alice', enabled: true, allocation: 1 }],
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields via .strict()', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, extra: 1 }).success).toBe(false);
  });

  it('rejects a wrong datePolicy', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, datePolicy: 'fixed' }).success).toBe(
      false,
    );
  });
});

describe('configDocumentSchema', () => {
  it('accepts a valid v3 document', () => {
    expect(
      configDocumentSchema.safeParse({ version: 3, revision: 3, config: validConfig }).success,
    ).toBe(true);
  });

  it('rejects the previous document version', () => {
    expect(
      configDocumentSchema.safeParse({ version: 2, revision: 3, config: validConfig }).success,
    ).toBe(false);
  });

  it('rejects a negative revision', () => {
    expect(
      configDocumentSchema.safeParse({ version: 3, revision: -1, config: validConfig }).success,
    ).toBe(false);
  });
});

describe('sprintEntrySchema / sprintDataDocumentSchema', () => {
  it('accepts a valid v3 entry (per-team state under teams)', () => {
    expect(sprintEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('rejects a bad date', () => {
    expect(sprintEntrySchema.safeParse({ ...validEntry, start: '01/01/2026' }).success).toBe(false);
  });

  it('rejects an entry with pre-teams top-level capacity fields', () => {
    expect(
      sprintEntrySchema.safeParse({ ...validEntry, capacityRevision: 1, capacity: validDoc })
        .success,
    ).toBe(false);
  });

  it('rejects a team entry with extra fields', () => {
    expect(
      sprintEntrySchema.safeParse({
        ...validEntry,
        teams: { 'team-1': { ...validTeamEntry, extra: 1 } },
      }).success,
    ).toBe(false);
  });

  it('accepts a valid sprint-data document', () => {
    expect(
      sprintDataDocumentSchema.safeParse({ version: 3, sprints: { '207-1': validEntry } }).success,
    ).toBe(true);
  });

  it('rejects the wrong document version', () => {
    expect(sprintDataDocumentSchema.safeParse({ version: 2, sprints: {} }).success).toBe(false);
  });
});
