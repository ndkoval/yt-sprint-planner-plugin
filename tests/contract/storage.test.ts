/**
 * Storage-layer normalization: untrusted persisted documents are migrated on read
 * (v2 → v3 teams) and strict-validated; anything unreadable is treated as absent.
 */
import { describe, it, expect } from 'vitest';
import {
  loadSprintData,
  normalizeConfigDocument,
  normalizeSprintData,
} from '../../src/backend/storage.js';
import { makeRow } from '../fixtures/capacity.js';
import { FakeProject } from './fake-env.js';
import { defaultConfig, MEMBER, TEAM_ID } from './setup.js';

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
  // v3 parse below would reject the document.
  managersGroup: 'Capacity Managers',
  participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
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

describe('normalizeConfigDocument', () => {
  it('passes a current v3 document through unchanged', () => {
    const doc = { version: 3, revision: 5, config: defaultConfig() };
    expect(normalizeConfigDocument(doc)).toEqual(doc);
  });

  it('migrates a v2 document to v3 and validates it', () => {
    const doc = normalizeConfigDocument({ version: 2, revision: 5, config: V2_CONFIG });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(3);
    expect(doc!.revision).toBe(5);
    expect(doc!.config.teams).toEqual([
      { id: TEAM_ID, name: 'Team 1', participants: V2_CONFIG.participants },
    ]);
    expect(doc!.config.nameTemplate).toBe('My {sequence}'); // non-legacy template untouched
    expect(Object.keys(doc!.config)).not.toContain('managersGroup'); // deliberately dropped
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
    expect(normalizeConfigDocument({ version: 3, revision: 1, config: { version: 3 } })).toBeNull();
    expect(
      normalizeConfigDocument({ version: 4, revision: 1, config: defaultConfig() }),
    ).toBeNull();
  });

  it('rejects unknown top-level keys after migration (strict parse)', () => {
    expect(
      normalizeConfigDocument({
        version: 3,
        revision: 1,
        config: defaultConfig(),
        legacyLeftover: true,
      }),
    ).toBeNull();
  });
});

describe('normalizeSprintData', () => {
  it('passes a current v3 document through unchanged', () => {
    const doc = {
      version: 3,
      sprints: {
        '207-1': {
          sequence: 1,
          name: 'Sprint 1',
          start: '2026-01-05',
          finish: '2026-01-18',
          teams: {
            [TEAM_ID]: {
              capacityRevision: 1,
              capacity: { version: 2, createdFromConfigVersion: 3, rows: {} },
              focusFactor: 0.75,
              focusFactorSource: 'bootstrap',
              focusFactorOverride: null,
              excludedFromCalibration: false,
              calibrationSkipReason: null,
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    };
    expect(normalizeSprintData(doc)).toEqual(doc);
  });

  it('migrates a v2 document: per-team fields move under teams["team-1"]', () => {
    const doc = normalizeSprintData({ version: 2, sprints: { '207-1': V2_ENTRY } });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(3);
    const entry = doc!.sprints['207-1']!;
    expect(entry).toMatchObject({
      sequence: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      finish: '2026-01-18',
      createdAt: 1,
      updatedAt: 2,
    });
    expect(entry.teams).toEqual({
      [TEAM_ID]: {
        capacityRevision: 3,
        capacity: V2_ENTRY.capacity,
        focusFactor: 0.6,
        focusFactorSource: 'calculated',
        focusFactorOverride: null,
        excludedFromCalibration: false,
        calibrationSkipReason: null,
      },
    });
  });

  it('returns null for v1, garbage and newer-than-current documents', () => {
    expect(normalizeSprintData({ version: 1, sprints: {} })).toBeNull();
    expect(normalizeSprintData(null)).toBeNull();
    expect(normalizeSprintData([])).toBeNull();
    expect(normalizeSprintData({ version: 3, sprints: { x: { bogus: true } } })).toBeNull();
    expect(normalizeSprintData({ version: 4, sprints: {} })).toBeNull();
  });
});

describe('loadSprintData', () => {
  it('falls back to an empty v3 document when the property is unset', () => {
    const project = new FakeProject('AGP', null);
    expect(loadSprintData(project)).toEqual({ version: 3, sprints: {} });
  });

  it('falls back for malformed JSON and unreadable (v1) documents', () => {
    const project = new FakeProject('AGP', null);
    project.setProperty('scpSprintDataJson', '{ nope');
    expect(loadSprintData(project)).toEqual({ version: 3, sprints: {} });
    project.setProperty('scpSprintDataJson', JSON.stringify({ version: 1, sprints: {} }));
    expect(loadSprintData(project)).toEqual({ version: 3, sprints: {} });
  });

  it('migrates a stored v2 document on read', () => {
    const project = new FakeProject('AGP', null);
    project.setProperty(
      'scpSprintDataJson',
      JSON.stringify({ version: 2, sprints: { '207-1': V2_ENTRY } }),
    );
    const data = loadSprintData(project);
    expect(data.version).toBe(3);
    expect(data.sprints['207-1']!.teams[TEAM_ID]!.focusFactor).toBe(0.6);
  });
});
