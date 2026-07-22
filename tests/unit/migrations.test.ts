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
// The real registered chains (v2 → v3 teams → v4 per-team settings).
// ---------------------------------------------------------------------------

type ConfigResult = Versioned & {
  config: Record<string, unknown> & { teams?: Record<string, unknown>[] };
};
type SprintDataResult = Versioned & {
  sprints?: Record<string, Record<string, unknown>>;
  teams?: Record<string, { sprints: Record<string, Record<string, unknown>> }>;
};

const upConfigTo = (doc: Versioned, target: number) =>
  migrate(doc, target, configMigrations) as ConfigResult;
const upConfig = (doc: Versioned) => upConfigTo(doc, CURRENT_CONFIG_VERSION);
const upSprintDataTo = (doc: Versioned, target: number) =>
  migrate(doc, target, sprintDataMigrations) as SprintDataResult;
const upSprintData = (doc: Versioned) => upSprintDataTo(doc, CURRENT_SPRINT_DATA_VERSION);

describe('registry current versions', () => {
  it('targets v4 for both the config and the sprint data documents', () => {
    expect(CURRENT_CONFIG_VERSION).toBe(4);
    expect(CURRENT_SPRINT_DATA_VERSION).toBe(4);
  });
});

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

describe('configMigrations v2 → v3 (pinned to v3)', () => {
  it('wraps the flat participants list into the single default team', () => {
    const result = upConfigTo(v2ConfigDoc(), 3);
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
    const migrated = upConfigTo(v2ConfigDoc(), 3);
    expect(migrated.config['nameTemplate']).toBe('Sprint {sequence}');
  });

  it('leaves any other name template untouched', () => {
    for (const template of [
      'My Sprint {sequence}',
      'appglass {year}-S{sequence}', // case differs — not the exact legacy literal
      'AppGlass {year}-S{sequence} ', // trailing space — not exact
      'Sprint {sequence}',
    ]) {
      const migrated = upConfigTo(v2ConfigDoc({ nameTemplate: template }), 3);
      expect(migrated.config['nameTemplate']).toBe(template);
    }
  });

  it('DROPS managersGroup (the removed custom permission scheme), not preserving it', () => {
    const result = upConfigTo(v2ConfigDoc(), 3);
    expect(Object.keys(result.config)).not.toContain('managersGroup');
  });

  it('preserves unknown fields on the document and on the config (except the dropped ones)', () => {
    const doc = v2ConfigDoc({ futureKnob: 'keep' });
    doc['docLevelExtra'] = 42;
    const result = upConfigTo(doc, 3);
    expect(result['docLevelExtra']).toBe(42);
    expect(result.config['futureKnob']).toBe('keep');
    expect(result.config['boardId']).toBe('board-1');
  });

  it('does not mutate the input document', () => {
    const doc = v2ConfigDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    upConfigTo(doc, 3);
    expect(doc).toEqual(snapshot);
  });

  it('tolerates a degenerate v2 document (missing config / participants) without throwing', () => {
    // The migration itself must be fail-safe; the storage layer's strict validation
    // is what rejects the (still incomplete) result afterwards.
    const result = upConfigTo({ version: 2, revision: 1 }, 3);
    expect(result.version).toBe(3);
    expect(result.config['teams']).toEqual([{ id: 'team-1', name: 'Team 1', participants: [] }]);
  });
});

// ---------------------------------------------------------------------------
// Config v3 → v4: all project-level settings fan out into every team.
// ---------------------------------------------------------------------------

const PROJECT_SETTINGS = {
  boardId: 'board-1',
  originalEffortField: 'Original estimation',
  currentEffortField: 'Estimation',
  hoursPerDay: 8,
  sprintLengthDays: 14,
  datePolicy: 'continuous',
  nameTemplate: 'Sprint {sequence}',
  backlogQuery: 'project: SCP #Unresolved',
  learningRate: 0.3,
} as const;

function v3ConfigDoc(
  configOverrides: Record<string, unknown> = {},
  teams: Record<string, unknown>[] = [
    {
      id: 'team-1',
      name: 'Alpha',
      participants: [{ userId: 'alice', enabled: true, allocation: 1 }],
    },
    {
      id: 'team-2',
      name: 'Beta',
      participants: [{ userId: 'bob', enabled: true, allocation: 0.5 }],
    },
  ],
): Versioned {
  return {
    version: 3,
    revision: 9,
    config: { version: 3, ...PROJECT_SETTINGS, teams, ...configOverrides },
  };
}

describe('configMigrations v3 → v4', () => {
  it('copies every project-level planning setting into each team', () => {
    const result = upConfigTo(v3ConfigDoc(), 4);
    expect(result.version).toBe(4);
    expect(result['revision']).toBe(9);
    expect(result.config['version']).toBe(4);
    const teams = result.config.teams!;
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({
      id: 'team-1',
      name: 'Alpha',
      participants: [{ userId: 'alice', enabled: true, allocation: 1 }],
      ...PROJECT_SETTINGS,
    });
    expect(teams[1]).toMatchObject({
      id: 'team-2',
      name: 'Beta',
      participants: [{ userId: 'bob', enabled: true, allocation: 0.5 }],
      ...PROJECT_SETTINGS,
    });
  });

  it('removes the fanned-out settings from the config top level', () => {
    const result = upConfigTo(v3ConfigDoc({ reminderLeadDays: 2 }), 4);
    const topLevelKeys = Object.keys(result.config);
    for (const key of [...Object.keys(PROJECT_SETTINGS), 'reminderLeadDays']) {
      expect(topLevelKeys).not.toContain(key);
    }
    expect(topLevelKeys).toContain('teams');
  });

  it("a team's non-empty backlogQuery override wins over the project query", () => {
    const result = upConfigTo(
      v3ConfigDoc({}, [
        { id: 'a', name: 'A', participants: [], backlogQuery: 'assignee: alice' },
        { id: 'b', name: 'B', participants: [] },
      ]),
      4,
    );
    const teams = result.config.teams!;
    expect(teams[0]!['backlogQuery']).toBe('assignee: alice');
    expect(teams[1]!['backlogQuery']).toBe(PROJECT_SETTINGS.backlogQuery);
  });

  it('keeps a winning override verbatim but treats a whitespace-only override as empty', () => {
    const result = upConfigTo(
      v3ConfigDoc({}, [
        { id: 'a', name: 'A', participants: [], backlogQuery: '  assignee: alice  ' },
        { id: 'b', name: 'B', participants: [], backlogQuery: '   ' },
        { id: 'c', name: 'C', participants: [], backlogQuery: '' },
      ]),
      4,
    );
    const teams = result.config.teams!;
    expect(teams[0]!['backlogQuery']).toBe('  assignee: alice  '); // not trimmed when kept
    expect(teams[1]!['backlogQuery']).toBe(PROJECT_SETTINGS.backlogQuery);
    expect(teams[2]!['backlogQuery']).toBe(PROJECT_SETTINGS.backlogQuery);
  });

  it('defaults backlogQuery to "" when neither the team nor the project had one', () => {
    const result = upConfigTo(
      v3ConfigDoc({ backlogQuery: undefined }, [{ id: 'a', name: 'A', participants: [] }]),
      4,
    );
    expect(result.config.teams![0]!['backlogQuery']).toBe('');
  });

  it('copies reminderLeadDays to every team when the project had one (including 0)', () => {
    for (const lead of [0, 3]) {
      const result = upConfigTo(v3ConfigDoc({ reminderLeadDays: lead }), 4);
      for (const team of result.config.teams!) {
        expect(team['reminderLeadDays']).toBe(lead);
      }
    }
  });

  it('omits reminderLeadDays entirely when the project had none', () => {
    const result = upConfigTo(v3ConfigDoc(), 4);
    for (const team of result.config.teams!) {
      expect(Object.keys(team)).not.toContain('reminderLeadDays');
    }
  });

  it('preserves unknown fields on the document, the config, and each team', () => {
    const doc = v3ConfigDoc({ futureKnob: 'keep' }, [
      { id: 'a', name: 'A', participants: [], futureTeamKnob: 'keep-team' },
    ]);
    doc['docLevelExtra'] = 42;
    const result = upConfigTo(doc, 4);
    expect(result['docLevelExtra']).toBe(42);
    expect(result.config['futureKnob']).toBe('keep');
    expect(result.config.teams![0]!['futureTeamKnob']).toBe('keep-team');
  });

  it('does not mutate the input document', () => {
    const doc = v3ConfigDoc({ reminderLeadDays: 1 });
    const snapshot = JSON.parse(JSON.stringify(doc));
    upConfigTo(doc, 4);
    expect(doc).toEqual(snapshot);
  });

  it('tolerates a degenerate v3 document (missing config / teams) without throwing', () => {
    const result = upConfigTo({ version: 3, revision: 1 }, 4);
    expect(result.version).toBe(4);
    expect(result.config['teams']).toEqual([]);
  });
});

describe('configMigrations full v2 → v4 chain', () => {
  it('lands on the current version with the fan-out applied to the wrapped default team', () => {
    const result = upConfig(v2ConfigDoc());
    expect(result.version).toBe(CURRENT_CONFIG_VERSION);
    expect(result['revision']).toBe(7);
    expect(result.config['version']).toBe(CURRENT_CONFIG_VERSION);
    const teams = result.config.teams!;
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      id: 'team-1',
      name: 'Team 1',
      participants: [
        { userId: 'alice', enabled: true, allocation: 1 },
        { userId: 'bob', enabled: false, allocation: 0.5 },
      ],
      boardId: 'board-1',
      hoursPerDay: 8,
      // The legacy default template was rewritten in v3, then fanned out in v4.
      nameTemplate: 'Sprint {sequence}',
      // v2 had no project backlogQuery, so the required string defaults to ''.
      backlogQuery: '',
    });
    expect(Object.keys(teams[0]!)).not.toContain('reminderLeadDays');
  });

  it('leaves the config top level with no project-scoped planning settings', () => {
    const result = upConfig(v2ConfigDoc());
    const topLevelKeys = Object.keys(result.config);
    for (const key of [
      'participants',
      'managersGroup',
      'boardId',
      'hoursPerDay',
      'nameTemplate',
      'backlogQuery',
      'reminderLeadDays',
    ]) {
      expect(topLevelKeys).not.toContain(key);
    }
  });

  it('fans out a custom name template untouched', () => {
    const result = upConfig(v2ConfigDoc({ nameTemplate: 'My Sprint {sequence}' }));
    expect(result.config.teams![0]!['nameTemplate']).toBe('My Sprint {sequence}');
  });

  it('preserves unknown fields across the whole chain', () => {
    const doc = v2ConfigDoc({ futureKnob: 'keep' });
    doc['docLevelExtra'] = 42;
    const result = upConfig(doc);
    expect(result['docLevelExtra']).toBe(42);
    expect(result.config['futureKnob']).toBe('keep');
  });
});

// ---------------------------------------------------------------------------
// Sprint data migrations.
// ---------------------------------------------------------------------------

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

describe('sprintDataMigrations v2 → v3 (pinned to v3)', () => {
  it('moves the per-team fields of each entry under teams["team-1"]', () => {
    const result = upSprintDataTo(v2SprintDoc(), 3);
    expect(result.version).toBe(3);
    const entry = result.sprints!['207-1']!;
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
    const result = upSprintDataTo(doc, 3);
    expect(result['docLevelExtra']).toBe(true);
    expect(result.sprints!['207-1']!['futureField']).toBe('keep-me');
  });

  it('migrates an empty sprint map to an empty v3 document', () => {
    expect(upSprintDataTo({ version: 2, sprints: {} }, 3)).toEqual({ version: 3, sprints: {} });
  });

  it('tolerates a degenerate v2 document with no sprints map', () => {
    expect(upSprintDataTo({ version: 2 }, 3)).toEqual({ version: 3, sprints: {} });
  });

  it('is a no-op for a v3 document when the target is pinned to v3', () => {
    const doc: Versioned = { version: 3, sprints: {} };
    expect(upSprintDataTo(doc, 3)).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// Sprint data v3 → v4: re-key team-first, folding shared fields per team.
// ---------------------------------------------------------------------------

const sprint1Shared = {
  sequence: 1,
  name: 'Sprint 1',
  start: '2026-01-05',
  finish: '2026-01-18',
  createdAt: 1,
  updatedAt: 2,
};
const sprint2Shared = {
  sequence: 2,
  name: 'Sprint 2',
  start: '2026-01-19',
  finish: '2026-02-01',
  createdAt: 3,
  updatedAt: 4,
};
const alphaFields = teamFields;
const betaFields = {
  ...teamFields,
  capacityRevision: 9,
  focusFactor: 0.4,
  focusFactorSource: 'default',
};

function v3SprintDoc(): Versioned {
  return {
    version: 3,
    sprints: {
      // One sprint shared by BOTH teams (all teams planned one board in v3)…
      '207-1': { ...sprint1Shared, teams: { alpha: { ...alphaFields }, beta: { ...betaFields } } },
      // …and one sprint that only alpha registered.
      '207-2': { ...sprint2Shared, teams: { alpha: { ...alphaFields, capacityRevision: 5 } } },
    },
  };
}

describe('sprintDataMigrations v3 → v4', () => {
  it('re-keys the document team-first and drops the legacy sprints map', () => {
    const result = upSprintDataTo(v3SprintDoc(), 4);
    expect(result.version).toBe(4);
    expect(Object.keys(result.teams!).sort()).toEqual(['alpha', 'beta']);
    expect(Object.keys(result.teams!['alpha']!.sprints).sort()).toEqual(['207-1', '207-2']);
    expect(Object.keys(result.teams!['beta']!.sprints)).toEqual(['207-1']);
    expect(Object.keys(result)).not.toContain('sprints');
  });

  it("folds each entry's shared Sprint fields into every team's copy", () => {
    const result = upSprintDataTo(v3SprintDoc(), 4);
    expect(result.teams!['alpha']!.sprints['207-1']).toEqual({ ...sprint1Shared, ...alphaFields });
    expect(result.teams!['beta']!.sprints['207-1']).toEqual({ ...sprint1Shared, ...betaFields });
    expect(result.teams!['alpha']!.sprints['207-2']).toEqual({
      ...sprint2Shared,
      ...alphaFields,
      capacityRevision: 5,
    });
  });

  it('lands a sprint shared by two teams in BOTH team maps, each with its own state', () => {
    const result = upSprintDataTo(v3SprintDoc(), 4);
    const alphaCopy = result.teams!['alpha']!.sprints['207-1']!;
    const betaCopy = result.teams!['beta']!.sprints['207-1']!;
    expect(alphaCopy['name']).toBe('Sprint 1');
    expect(betaCopy['name']).toBe('Sprint 1');
    expect(alphaCopy['capacityRevision']).toBe(4);
    expect(betaCopy['capacityRevision']).toBe(9);
  });

  it("lets the team-level value win over a shared field on a key collision", () => {
    const result = upSprintDataTo(
      {
        version: 3,
        sprints: {
          '207-1': {
            ...sprint1Shared,
            note: 'shared',
            teams: { alpha: { ...alphaFields, note: 'team' } },
          },
        },
      },
      4,
    );
    expect(result.teams!['alpha']!.sprints['207-1']!['note']).toBe('team');
  });

  it('preserves unknown fields: doc level kept, entry level folded per team, team level kept', () => {
    const doc: Versioned = {
      version: 3,
      docLevelExtra: true,
      sprints: {
        '207-1': {
          ...sprint1Shared,
          futureShared: 'keep-shared',
          teams: {
            alpha: { ...alphaFields, futureTeamField: 'keep-team' },
            beta: { ...betaFields },
          },
        },
      },
    };
    const result = upSprintDataTo(doc, 4);
    expect(result['docLevelExtra']).toBe(true);
    expect(result.teams!['alpha']!.sprints['207-1']!['futureShared']).toBe('keep-shared');
    expect(result.teams!['beta']!.sprints['207-1']!['futureShared']).toBe('keep-shared');
    expect(result.teams!['alpha']!.sprints['207-1']!['futureTeamField']).toBe('keep-team');
    expect(result.teams!['beta']!.sprints['207-1']!['futureTeamField']).toBeUndefined();
  });

  it('migrates an empty sprints map to an empty v4 document', () => {
    expect(upSprintDataTo({ version: 3, sprints: {} }, 4)).toEqual({ version: 4, teams: {} });
  });

  it('tolerates a degenerate v3 document with no sprints map', () => {
    expect(upSprintDataTo({ version: 3 }, 4)).toEqual({ version: 4, teams: {} });
  });

  it('drops an entry whose teams map is missing or empty (no team ever registered it)', () => {
    const result = upSprintDataTo(
      {
        version: 3,
        sprints: {
          '207-1': { ...sprint1Shared }, // no teams map at all
          '207-2': { ...sprint2Shared, teams: {} },
        },
      },
      4,
    );
    expect(result).toEqual({ version: 4, teams: {} });
  });

  it('does not mutate the input document', () => {
    const doc = v3SprintDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    upSprintDataTo(doc, 4);
    expect(doc).toEqual(snapshot);
  });

  it('is a no-op for an already-current v4 document', () => {
    const doc: Versioned = { version: 4, teams: {} };
    expect(upSprintData(doc)).toBe(doc);
  });
});

describe('sprintDataMigrations full v2 → v4 chain', () => {
  it('lands the flat v2 entry under teams["team-1"].sprints keyed by the sprint id', () => {
    const result = upSprintData(v2SprintDoc());
    expect(result.version).toBe(CURRENT_SPRINT_DATA_VERSION);
    expect(Object.keys(result.teams!)).toEqual(['team-1']);
    expect(result.teams!['team-1']!.sprints['207-1']).toEqual({
      sequence: 1,
      name: 'Sprint 1',
      start: '2026-01-05',
      finish: '2026-01-18',
      createdAt: 1,
      updatedAt: 2,
      futureField: 'keep-me',
      ...teamFields,
    });
    expect(Object.keys(result)).not.toContain('sprints');
  });

  it('preserves document-level unknown fields across the whole chain', () => {
    const doc = v2SprintDoc();
    doc['docLevelExtra'] = true;
    const result = upSprintData(doc);
    expect(result['docLevelExtra']).toBe(true);
  });
});
