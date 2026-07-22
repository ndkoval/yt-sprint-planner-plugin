/**
 * Storage-layer normalization: untrusted persisted documents are migrated on read
 * (v2 → v3 teams → v4 per-team settings / team-first sprint data) and
 * strict-validated; anything unreadable is treated as absent.
 */
import { describe, it, expect } from 'vitest';
import {
  loadSprintData,
  normalizeConfigDocument,
  normalizeSprintData,
} from '../../src/backend/storage.js';
import { makeRow, makeTeamSprint } from '../fixtures/capacity.js';
import { FakeProject } from './fake-env.js';
import { defaultConfig, MEMBER, MEMBER_2, TEAM_ID, TEAM_2_ID } from './setup.js';

const V2_CONFIG = {
  version: 2,
  boardId: 'board-1',
  originalEffortField: 'Original estimation',
  currentEffortField: 'Estimation',
  hoursPerDay: 8,
  sprintLengthDays: 14,
  datePolicy: 'continuous',
  nameTemplate: 'My {sequence}',
  backlogQuery: '',
  learningRate: 0.5,
  // v2-era custom-permission field; the migration must strip it or the strict
  // v4 parse below would reject the document.
  managersGroup: 'Capacity Managers',
  participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
};

/** A v3 config: project-level settings + teams that only carry membership. */
const V3_CONFIG = {
  version: 3,
  boardId: 'board-1',
  originalEffortField: 'Original estimation',
  currentEffortField: 'Estimation',
  hoursPerDay: 6,
  sprintLengthDays: 7,
  datePolicy: 'continuous',
  nameTemplate: 'My {sequence}',
  backlogQuery: 'project: AGP #Unresolved',
  learningRate: 0.4,
  reminderLeadDays: 3,
  teams: [
    {
      id: TEAM_ID,
      name: 'Alpha',
      participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
    },
    {
      id: TEAM_2_ID,
      name: 'Beta',
      participants: [{ userId: MEMBER_2.login, enabled: true, allocation: 1 }],
      // Non-empty per-team override — must win over the project-level query.
      backlogQuery: 'for: me',
    },
  ],
};

const V2_ENTRY = {
  sequence: 1,
  name: 'Sprint 1',
  start: '2026-01-05',
  finish: '2026-01-18',
  capacityRevision: 3,
  capacity: { version: 2, createdFromConfigVersion: 1, rows: { [MEMBER.login]: makeRow({ userId: MEMBER.login }) } },
  focusFactor: 0.6,
  focusFactorSource: 'calculated',
  focusFactorOverride: null,
  excludedFromCalibration: false,
  calibrationSkipReason: null,
  createdAt: 1,
  updatedAt: 2,
};

/** The per-team half of a v3 sprint entry (what lived under `teams[teamId]`). */
function v3TeamPart(focusFactor: number, focusFactorSource: string) {
  return {
    capacityRevision: 1,
    capacity: { version: 2, createdFromConfigVersion: 3, rows: {} },
    focusFactor,
    focusFactorSource,
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
  };
}

/** A v3 sprint entry shared by two teams (shared fields at the sprint level). */
const V3_ENTRY = {
  sequence: 1,
  name: 'Sprint 1',
  start: '2026-01-05',
  finish: '2026-01-18',
  teams: {
    [TEAM_ID]: v3TeamPart(0.75, 'bootstrap'),
    [TEAM_2_ID]: v3TeamPart(0.6, 'calculated'),
  },
  createdAt: 1,
  updatedAt: 2,
};

describe('normalizeConfigDocument', () => {
  it('passes a current v4 document through unchanged', () => {
    const doc = { version: 4, revision: 5, config: defaultConfig() };
    expect(normalizeConfigDocument(doc)).toEqual(doc);
  });

  it('migrates a v2 document to v4: one default team carrying every setting', () => {
    const doc = normalizeConfigDocument({ version: 2, revision: 5, config: V2_CONFIG });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(4);
    expect(doc!.revision).toBe(5);
    expect(doc!.config).toEqual({
      version: 4,
      teams: [
        {
          id: TEAM_ID,
          name: 'Team 1',
          participants: V2_CONFIG.participants,
          boardId: 'board-1',
          originalEffortField: 'Original estimation',
          currentEffortField: 'Estimation',
          hoursPerDay: 8,
          sprintLengthDays: 14,
          datePolicy: 'continuous',
          nameTemplate: 'My {sequence}', // non-legacy template untouched
          backlogQuery: '',
          learningRate: 0.5,
        },
      ],
    });
    // v2-era custom-permission field is deliberately dropped by the migration.
    expect(JSON.stringify(doc)).not.toContain('managersGroup');
  });

  it('migrates a v3 document to v4: project settings copied into every team', () => {
    const doc = normalizeConfigDocument({ version: 3, revision: 7, config: V3_CONFIG });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(4);
    expect(doc!.revision).toBe(7);
    expect(doc!.config.teams).toHaveLength(2);
    const [alpha, beta] = doc!.config.teams;
    expect(alpha).toEqual({
      id: TEAM_ID,
      name: 'Alpha',
      participants: V3_CONFIG.teams[0]!.participants,
      boardId: 'board-1',
      originalEffortField: 'Original estimation',
      currentEffortField: 'Estimation',
      hoursPerDay: 6,
      sprintLengthDays: 7,
      datePolicy: 'continuous',
      nameTemplate: 'My {sequence}',
      // No per-team override → the project-level query is inherited.
      backlogQuery: 'project: AGP #Unresolved',
      learningRate: 0.4,
      // The project-level reminder override becomes each team's override.
      reminderLeadDays: 3,
    });
    // Beta's own non-empty backlogQuery override wins over the project query.
    expect(beta!.backlogQuery).toBe('for: me');
    expect(beta!.reminderLeadDays).toBe(3);
    // No project-level settings survive at the top level of a v4 config.
    expect(Object.keys(doc!.config).sort()).toEqual(['teams', 'version']);
  });

  it('returns null for a v1 document (no offline upgrade path)', () => {
    expect(normalizeConfigDocument({ version: 1, revision: 1, config: {} })).toBeNull();
  });

  it('returns null for garbage, malformed and newer-than-current documents', () => {
    expect(normalizeConfigDocument(null)).toBeNull();
    expect(normalizeConfigDocument('nope')).toBeNull();
    expect(normalizeConfigDocument(42)).toBeNull();
    expect(normalizeConfigDocument({})).toBeNull();
    expect(normalizeConfigDocument({ version: 'x' })).toBeNull();
    expect(normalizeConfigDocument({ version: 4, revision: 1, config: { version: 4 } })).toBeNull();
    expect(
      normalizeConfigDocument({ version: 5, revision: 1, config: defaultConfig() }),
    ).toBeNull();
  });

  it('rejects unknown top-level keys after migration (strict parse)', () => {
    expect(
      normalizeConfigDocument({
        version: 4,
        revision: 1,
        config: defaultConfig(),
        legacyLeftover: true,
      }),
    ).toBeNull();
  });
});

describe('normalizeSprintData', () => {
  it('passes a current v4 document through unchanged', () => {
    const doc = {
      version: 4,
      teams: {
        [TEAM_ID]: { sprints: { '207-1': makeTeamSprint() } },
      },
    };
    expect(normalizeSprintData(doc)).toEqual(doc);
  });

  it('migrates a v2 document: the flat entry becomes teams["team-1"].sprints[id]', () => {
    const doc = normalizeSprintData({ version: 2, sprints: { '207-1': V2_ENTRY } });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(4);
    expect(Object.keys(doc!.teams)).toEqual([TEAM_ID]);
    // The whole v2 entry (shared fields + planning state) is the team's sprint now.
    expect(doc!.teams[TEAM_ID]!.sprints).toEqual({ '207-1': V2_ENTRY });
  });

  it('migrates a v3 document: re-keyed team-first, shared fields folded into each team', () => {
    const doc = normalizeSprintData({ version: 3, sprints: { '207-1': V3_ENTRY } });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(4);
    expect(Object.keys(doc!.teams).sort()).toEqual([TEAM_ID, TEAM_2_ID]);
    const shared = {
      sequence: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      finish: '2026-01-18',
      createdAt: 1,
      updatedAt: 2,
    };
    expect(doc!.teams[TEAM_ID]!.sprints).toEqual({
      '207-1': { ...shared, ...v3TeamPart(0.75, 'bootstrap') },
    });
    expect(doc!.teams[TEAM_2_ID]!.sprints).toEqual({
      '207-1': { ...shared, ...v3TeamPart(0.6, 'calculated') },
    });
  });

  it('returns null for v1, garbage and newer-than-current documents', () => {
    expect(normalizeSprintData({ version: 1, sprints: {} })).toBeNull();
    expect(normalizeSprintData(null)).toBeNull();
    expect(normalizeSprintData([])).toBeNull();
    expect(normalizeSprintData({ version: 4, teams: { x: { bogus: true } } })).toBeNull();
    expect(normalizeSprintData({ version: 5, teams: {} })).toBeNull();
  });
});

describe('loadSprintData', () => {
  it('falls back to an empty v4 document when the property is unset', () => {
    const project = new FakeProject('AGP', null);
    expect(loadSprintData(project)).toEqual({ version: 4, teams: {} });
  });

  it('falls back for malformed JSON and unreadable (v1) documents', () => {
    const project = new FakeProject('AGP', null);
    project.setProperty('scpSprintDataJson', '{ nope');
    expect(loadSprintData(project)).toEqual({ version: 4, teams: {} });
    project.setProperty('scpSprintDataJson', JSON.stringify({ version: 1, sprints: {} }));
    expect(loadSprintData(project)).toEqual({ version: 4, teams: {} });
  });

  it('migrates a stored v2 document on read', () => {
    const project = new FakeProject('AGP', null);
    project.setProperty(
      'scpSprintDataJson',
      JSON.stringify({ version: 2, sprints: { '207-1': V2_ENTRY } }),
    );
    const data = loadSprintData(project);
    expect(data.version).toBe(4);
    expect(data.teams[TEAM_ID]!.sprints['207-1']!.focusFactor).toBe(0.6);
  });

  it('migrates a stored v3 document on read (team-first re-keying)', () => {
    const project = new FakeProject('AGP', null);
    project.setProperty(
      'scpSprintDataJson',
      JSON.stringify({ version: 3, sprints: { '207-1': V3_ENTRY } }),
    );
    const data = loadSprintData(project);
    expect(data.version).toBe(4);
    expect(data.teams[TEAM_ID]!.sprints['207-1']!.focusFactor).toBe(0.75);
    expect(data.teams[TEAM_2_ID]!.sprints['207-1']!.focusFactor).toBe(0.6);
    // The shared v3 fields were folded into each team's copy.
    expect(data.teams[TEAM_2_ID]!.sprints['207-1']!.name).toBe('Sprint 1');
  });
});
