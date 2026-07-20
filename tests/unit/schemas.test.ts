import { describe, it, expect } from 'vitest';
import {
  userIdSchema,
  capacityRowSchema,
  capacityDocumentSchema,
  completionCalculationSchema,
  issueSnapshotSchema,
  focusFactorOverrideSchema,
  participantSchema,
  projectConfigSchema,
} from '../../src/shared/schemas.js';

const validRow = {
  userId: '1-1',
  loginSnapshot: 'login',
  displayNameSnapshot: 'Name',
  defaultMinutes: 4800,
  availableMinutes: 4800,
  availableWasCustomized: false,
  note: '',
  updatedAt: 0,
  updatedBy: '1-1',
};

const validDoc = {
  version: 1,
  createdFromConfigVersion: 1,
  rows: { '1-1': validRow },
};

const validCompletion = {
  version: 1,
  calculatedAt: 1,
  sprintStart: 1,
  sprintFinish: 2,
  rawCapacityMinutes: 4800,
  originalEffortMinutes: 100,
  completedOriginalEffortMinutes: 50,
  observedFocusFactor: 0.5,
  calculationRevision: 3,
};

const validSnapshot = {
  version: 1,
  managedSprintIds: ['3-1'],
  originalEffortMinutes: 100,
  currentEffortMinutes: 50,
  resolved: false,
  resolvedAt: null,
  updatedAt: 1,
};

const validConfig = {
  version: 1,
  boardId: 'board-1',
  originalEffortField: 'Original estimation',
  currentEffortField: 'Estimation',
  hoursPerDay: 8,
  sprintLengthDays: 14,
  datePolicy: 'continuous',
  nameTemplate: 'AppGlass {year}-S{sequence}',
  learningRate: 0.2,
  participants: [{ userId: '1-1', enabled: true, allocation: 1 }],
};

describe('userIdSchema', () => {
  it('accepts a YouTrack id', () => {
    expect(userIdSchema.safeParse('1-123').success).toBe(true);
  });

  it('rejects a malformed id', () => {
    expect(userIdSchema.safeParse('abc').success).toBe(false);
    expect(userIdSchema.safeParse('1_123').success).toBe(false);
  });
});

describe('capacityRowSchema', () => {
  it('accepts a valid row', () => {
    expect(capacityRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects a bad user id', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, userId: 'nope' }).success).toBe(false);
  });

  it('rejects negative minutes', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, availableMinutes: -1 }).success).toBe(false);
  });

  it('rejects an unknown extra field (strict)', () => {
    expect(capacityRowSchema.safeParse({ ...validRow, allocation: 1 }).success).toBe(false);
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
  it('accepts a valid document', () => {
    expect(capacityDocumentSchema.safeParse(validDoc).success).toBe(true);
  });

  it('rejects a wrong version literal', () => {
    expect(capacityDocumentSchema.safeParse({ ...validDoc, version: 2 }).success).toBe(false);
  });

  it('rejects a row keyed by a non-user id', () => {
    expect(
      capacityDocumentSchema.safeParse({ ...validDoc, rows: { bad: validRow } }).success,
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(capacityDocumentSchema.safeParse({ ...validDoc, extra: 1 }).success).toBe(false);
  });
});

describe('completionCalculationSchema', () => {
  it('accepts a valid calculation', () => {
    expect(completionCalculationSchema.safeParse(validCompletion).success).toBe(true);
  });

  it('accepts a null observed focus factor', () => {
    expect(
      completionCalculationSchema.safeParse({ ...validCompletion, observedFocusFactor: null }).success,
    ).toBe(true);
  });

  it('rejects negative minutes', () => {
    expect(
      completionCalculationSchema.safeParse({ ...validCompletion, rawCapacityMinutes: -1 }).success,
    ).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { calculatedAt: _c, ...rest } = validCompletion;
    expect(completionCalculationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(completionCalculationSchema.safeParse({ ...validCompletion, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('issueSnapshotSchema', () => {
  it('accepts a valid snapshot', () => {
    expect(issueSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('accepts a numeric resolvedAt', () => {
    expect(
      issueSnapshotSchema.safeParse({ ...validSnapshot, resolved: true, resolvedAt: 5 }).success,
    ).toBe(true);
  });

  it('rejects negative minutes', () => {
    expect(
      issueSnapshotSchema.safeParse({ ...validSnapshot, currentEffortMinutes: -1 }).success,
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(issueSnapshotSchema.safeParse({ ...validSnapshot, extra: 1 }).success).toBe(false);
  });
});

describe('focusFactorOverrideSchema', () => {
  const valid = { reason: 'holiday', oldValue: 0.7, newValue: 0.5, userId: '1-1', timestamp: 1 };

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
    const parsed = participantSchema.parse({ userId: '1-1', enabled: true });
    expect(parsed.allocation).toBe(1);
    expect(
      participantSchema.safeParse({ userId: '1-1', enabled: false, note: 'x', allocation: 0.5 })
        .success,
    ).toBe(true);
  });

  it('rejects an out-of-range allocation', () => {
    expect(
      participantSchema.safeParse({ userId: '1-1', enabled: true, allocation: 0 }).success,
    ).toBe(false);
    expect(
      participantSchema.safeParse({ userId: '1-1', enabled: true, allocation: 1.5 }).success,
    ).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(
      participantSchema.safeParse({ userId: '1-1', enabled: true, bogus: 1 }).success,
    ).toBe(false);
  });
});

describe('projectConfigSchema', () => {
  it('accepts a valid config', () => {
    expect(projectConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it('rejects minFocusFactor >= maxFocusFactor', () => {
    expect(
      projectConfigSchema.safeParse({ ...validConfig, minFocusFactor: 0.9, maxFocusFactor: 0.9 })
        .success,
    ).toBe(false);
    expect(
      projectConfigSchema.safeParse({ ...validConfig, minFocusFactor: 0.95, maxFocusFactor: 0.9 })
        .success,
    ).toBe(false);
  });

  it('rejects a bad firstSprintStart format', () => {
    expect(
      projectConfigSchema.safeParse({ ...validConfig, firstSprintStart: '07/13/2026' }).success,
    ).toBe(false);
  });

  it('rejects a non-positive hoursPerDay', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, hoursPerDay: 0 }).success).toBe(false);
  });

  it('rejects a non-integer sprintLengthDays', () => {
    expect(projectConfigSchema.safeParse({ ...validConfig, sprintLengthDays: 2.5 }).success).toBe(
      false,
    );
  });

  it('rejects a missing required field', () => {
    const { boardId: _b, ...rest } = validConfig;
    expect(projectConfigSchema.safeParse(rest).success).toBe(false);
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
