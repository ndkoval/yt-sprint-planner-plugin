import { describe, it, expect } from 'vitest';
import { migrate, type Migration, type Versioned } from '../../src/domain/migrations/migrations.js';
import {
  CURRENT_CONFIG_VERSION,
  CURRENT_SPRINT_DATA_VERSION,
  configMigrations,
  sprintDataMigrations,
} from '../../src/domain/migrations/registry.js';

interface Doc extends Versioned {
  version: number;
  payload?: unknown;
}

/** A step that just bumps the version (and records the hop). */
function bump(from: number): Migration<Doc> {
  return {
    fromVersion: from,
    up: (doc) => ({ ...doc, version: from + 1, [`step${from}`]: true }),
  };
}

describe('migrate', () => {
  it('is a no-op when already at the target version', () => {
    const doc: Doc = { version: 3, payload: 'x' };
    const result = migrate(doc, 3, [bump(1), bump(2)]);
    expect(result).toBe(doc);
  });

  it('applies a sequential chain of steps', () => {
    const doc: Doc = { version: 1 };
    const result = migrate(doc, 3, [bump(1), bump(2)]);
    expect(result.version).toBe(3);
    expect(result.step1).toBe(true);
    expect(result.step2).toBe(true);
  });

  it('preserves unknown fields through a migration', () => {
    const doc: Doc = { version: 1, payload: { keep: 'me' } };
    const result = migrate(doc, 2, [bump(1)]);
    expect(result.payload).toEqual({ keep: 'me' });
  });

  it('does not mutate the input document', () => {
    const doc: Doc = { version: 1, payload: 'x' };
    const snapshot = JSON.parse(JSON.stringify(doc));
    migrate(doc, 2, [bump(1)]);
    expect(doc).toEqual(snapshot);
  });

  it('throws when a required step is missing', () => {
    const doc: Doc = { version: 1 };
    expect(() => migrate(doc, 3, [bump(1)])).toThrow(/missing migration from version 2/);
  });

  it('throws on a duplicate fromVersion', () => {
    const doc: Doc = { version: 1 };
    expect(() => migrate(doc, 2, [bump(1), bump(1)])).toThrow(/duplicate migration from version 1/);
  });

  it('throws when a step produces the wrong output version', () => {
    const doc: Doc = { version: 1 };
    const bad: Migration<Doc> = { fromVersion: 1, up: (d) => ({ ...d, version: 5 }) };
    expect(() => migrate(doc, 2, [bad])).toThrow(/produced version 5, expected 2/);
  });

  it('throws on a downgrade (document newer than target)', () => {
    const doc: Doc = { version: 5 };
    expect(() => migrate(doc, 2, [])).toThrow(/downgrade is not supported/);
  });

  it('throws when the document has no numeric version', () => {
    const doc = { version: 'oops' } as unknown as Doc;
    expect(() => migrate(doc, 2, [])).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// The real registered chains (v2 → v3 teams).
// ---------------------------------------------------------------------------

const upConfig = (doc: Versioned) =>
  migrate(doc, CURRENT_CONFIG_VERSION, configMigrations) as Versioned & {
    config: Record<string, unknown>;
  };
const upSprintData = (doc: Versioned) =>
  migrate(doc, CURRENT_SPRINT_DATA_VERSION, sprintDataMigrations) as Versioned & {
    sprints: Record<string, Record<string, unknown>>;
  };

function v2ConfigDoc(configOverrides: Record<string, unknown> = {}): Versioned {
  return {
    version: 2,
    revision: 7,
    config: {
      version: 2,
      boardId: 'board-1',
      hoursPerDay: 8,
      nameTemplate: 'AppGlass {year}-S{sequence}',
      managersGroup: 'Capacity Managers', // v2-era custom-permission field
      participants: [
        { userId: 'alice', enabled: true, allocation: 1 },
        { userId: 'bob', enabled: false, allocation: 0.5 },
      ],
      ...configOverrides,
    },
  };
}

describe('configMigrations v2 → v3', () => {
  it('wraps the flat participants list into the single default team', () => {
    const result = upConfig(v2ConfigDoc());
    expect(result.version).toBe(3);
    expect(result['revision']).toBe(7);
    expect(result.config['version']).toBe(3);
    expect(result.config['participants']).toBeUndefined();
    expect(result.config['teams']).toEqual([
      {
        id: 'team-1',
        name: 'Team 1',
        participants: [
          { userId: 'alice', enabled: true, allocation: 1 },
          { userId: 'bob', enabled: false, allocation: 0.5 },
        ],
      },
    ]);
  });

  it('rewrites EXACTLY the legacy default name template to the generic default', () => {
    const migrated = upConfig(v2ConfigDoc());
    expect(migrated.config['nameTemplate']).toBe('Sprint {sequence}');
  });

  it('leaves any other name template untouched', () => {
    for (const template of [
      'My Sprint {sequence}',
      'appglass {year}-S{sequence}', // case differs — not the exact legacy literal
      'AppGlass {year}-S{sequence} ', // trailing space — not exact
      'Sprint {sequence}',
    ]) {
      const migrated = upConfig(v2ConfigDoc({ nameTemplate: template }));
      expect(migrated.config['nameTemplate']).toBe(template);
    }
  });

  it('DROPS managersGroup (the removed custom permission scheme), not preserving it', () => {
    const result = upConfig(v2ConfigDoc());
    expect(Object.keys(result.config)).not.toContain('managersGroup');
  });

  it('preserves unknown fields on the document and on the config (except the dropped ones)', () => {
    const doc = v2ConfigDoc({ futureKnob: 'keep' });
    doc['docLevelExtra'] = 42;
    const result = upConfig(doc);
    expect(result['docLevelExtra']).toBe(42);
    expect(result.config['futureKnob']).toBe('keep');
    expect(result.config['boardId']).toBe('board-1');
  });

  it('does not mutate the input document', () => {
    const doc = v2ConfigDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    upConfig(doc);
    expect(doc).toEqual(snapshot);
  });

  it('tolerates a degenerate v2 document (missing config / participants) without throwing', () => {
    // The migration itself must be fail-safe; the storage layer's strict validation
    // is what rejects the (still incomplete) result afterwards.
    const result = upConfig({ version: 2, revision: 1 });
    expect(result.version).toBe(3);
    expect(result.config['teams']).toEqual([{ id: 'team-1', name: 'Team 1', participants: [] }]);
  });
});

describe('sprintDataMigrations v2 → v3', () => {
  const teamFields = {
    capacityRevision: 4,
    capacity: { version: 2, createdFromConfigVersion: 1, rows: {} },
    focusFactor: 0.6,
    focusFactorSource: 'calculated',
    focusFactorOverride: { reason: 'r', oldValue: 0.75, newValue: 0.6, userId: 'boss', timestamp: 9 },
    excludedFromCalibration: true,
    calibrationSkipReason: 'holidays',
  };

  function v2SprintDoc(): Versioned {
    return {
      version: 2,
      sprints: {
        '207-1': {
          sequence: 1,
          name: 'Sprint 1',
          start: '2026-01-05',
          finish: '2026-01-18',
          createdAt: 1,
          updatedAt: 2,
          futureField: 'keep-me',
          ...teamFields,
        },
      },
    };
  }

  it('moves the per-team fields of each entry under teams["team-1"]', () => {
    const result = upSprintData(v2SprintDoc());
    expect(result.version).toBe(3);
    const entry = result.sprints['207-1']!;
    expect(entry['teams']).toEqual({ 'team-1': teamFields });
    // The moved fields are gone from the entry's top level.
    for (const key of Object.keys(teamFields)) expect(entry[key]).toBeUndefined();
    // Sprint-level fields stay at the top level.
    expect(entry).toMatchObject({
      sequence: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      finish: '2026-01-18',
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it('preserves unknown fields on entries and on the document', () => {
    const doc = v2SprintDoc();
    doc['docLevelExtra'] = true;
    const result = upSprintData(doc);
    expect(result['docLevelExtra']).toBe(true);
    expect(result.sprints['207-1']!['futureField']).toBe('keep-me');
  });

  it('migrates an empty sprint map to an empty v3 document', () => {
    expect(upSprintData({ version: 2, sprints: {} })).toEqual({ version: 3, sprints: {} });
  });

  it('tolerates a degenerate v2 document with no sprints map', () => {
    expect(upSprintData({ version: 2 })).toEqual({ version: 3, sprints: {} });
  });

  it('is a no-op for an already-current v3 document', () => {
    const doc: Versioned = { version: 3, sprints: {} };
    expect(upSprintData(doc)).toBe(doc);
  });
});
