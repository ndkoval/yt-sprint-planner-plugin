/**
 * Unit tests for the availability-reminder workflow's exported _internals.
 *
 * The workflow is a CommonJS module written for YouTrack's scripting runtime; it is
 * evaluated here inside a CommonJS-style wrapper with a stubbed
 * `@jetbrains/youtrack-scripting-api/entities`, so `Issue.onSchedule` registration and
 * `User.findByLogin` notifications run against test doubles.
 *
 * The primary era is v4 (per-team sprint maps, `teamId/sprintId` stamp keys, per-team
 * `reminderLeadDays`); the rule must ALSO keep working against v2/v3 documents that
 * have not been lazily migrated yet, so those tolerance tests are kept.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTeam } from '../fixtures/capacity.js';

const WORKFLOW_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../src/workflows/workflow-availability-reminder.js',
);

interface StubUser {
  notify(subject: string, body: string): void;
}

interface EntitiesStub {
  Issue: { onSchedule(rule: Record<string, unknown>): Record<string, unknown> };
  User: { findByLogin(login: string): StubUser | null };
}

interface WorkflowProject {
  extensionProperties: Record<string, string | undefined>;
}

interface ReminderUnit {
  key: string;
  entry: Record<string, unknown>;
  rowMaps: Array<Record<string, unknown>>;
  leadDays: number;
}

interface WorkflowInternals {
  remindForProject(project: WorkflowProject, appLeadDays: number, nowMs: number): void;
  reminderUnits(
    data: Record<string, unknown>,
    config: unknown,
    appLeadDays: number,
  ): ReminderUnit[];
  capacityRowMaps(entry: Record<string, unknown>): Array<Record<string, unknown>>;
  leadDaysOf(value: unknown): number | null;
}

interface Notification {
  login: string;
  subject: string;
}

/**
 * Evaluate the workflow module with a stubbed scripting API. The evaluated string is
 * the repo's own workflow source read from a fixed path — nothing untrusted is ever
 * interpolated into the function body.
 */
function loadWorkflow(entities: EntitiesStub): {
  internals: WorkflowInternals;
  rule: Record<string, unknown>;
} {
  const code = readFileSync(WORKFLOW_PATH, 'utf8');
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const requireStub = (id: string): unknown => {
    if (id === '@jetbrains/youtrack-scripting-api/entities') return entities;
    throw new Error(`unexpected require("${id}") from the workflow module`);
  };
  const factory = new Function('require', 'exports', 'module', code) as (
    req: typeof requireStub,
    exp: Record<string, unknown>,
    mod: typeof moduleObj,
  ) => void;
  factory(requireStub, moduleObj.exports, moduleObj);
  return {
    internals: moduleObj.exports['_internals'] as WorkflowInternals,
    rule: moduleObj.exports['rule'] as Record<string, unknown>,
  };
}

/** A world with a user directory that records notifications. */
function makeWorld(logins: readonly string[]) {
  const notifications: Notification[] = [];
  const known = new Set(logins);
  const entities: EntitiesStub = {
    Issue: { onSchedule: (rule) => rule },
    User: {
      findByLogin: (login) =>
        known.has(login)
          ? { notify: (subject: string) => notifications.push({ login, subject }) }
          : null,
    },
  };
  const { internals, rule } = loadWorkflow(entities);
  return { internals, rule, notifications };
}

const NOW = Date.UTC(2026, 6, 20); // 2026-07-20 (UTC midnight)

const row = (userId: string, customized: boolean) => ({
  userId,
  displayNameSnapshot: userId,
  defaultMinutes: 4800,
  availableMinutes: customized ? 3000 : 4800,
  availableWasCustomized: customized,
  note: '',
  updatedAt: 0,
  updatedBy: userId,
});

/** One team's v4 per-Sprint entry (capacity at the entry's top level). */
function teamSprintEntry(
  rows: Record<string, unknown>,
  start = '2026-07-22',
  finish = '2026-08-04',
) {
  return {
    sequence: 1,
    name: 'Sprint 1',
    start,
    finish,
    capacityRevision: 1,
    capacity: { version: 2, createdFromConfigVersion: 4, rows },
    focusFactor: 0.75,
    focusFactorSource: 'bootstrap',
    focusFactorOverride: null,
    excludedFromCalibration: false,
    calibrationSkipReason: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * v4 sprint data: team-first maps. Both teams manage the SAME upcoming native sprint
 * S-1 (starts in 2 days) with their own independent entries.
 */
function v4Data() {
  return {
    version: 4,
    teams: {
      'team-1': {
        sprints: {
          'S-1': teamSprintEntry({ alice: row('alice', false), bob: row('bob', true) }),
        },
      },
      'team-2': {
        sprints: {
          'S-1': teamSprintEntry({ carol: row('carol', false) }),
        },
      },
    },
  };
}

/** v3 (legacy, not yet migrated) sprint data: an upcoming shared sprint with two teams. */
function v3Data() {
  return {
    version: 3,
    sprints: {
      'S-1': {
        sequence: 1,
        name: 'Sprint 1',
        start: '2026-07-22',
        finish: '2026-08-04',
        teams: {
          'team-1': {
            capacityRevision: 1,
            capacity: {
              version: 2,
              createdFromConfigVersion: 3,
              rows: { alice: row('alice', false), bob: row('bob', true) },
            },
            focusFactor: 0.75,
            focusFactorSource: 'bootstrap',
            focusFactorOverride: null,
            excludedFromCalibration: false,
            calibrationSkipReason: null,
          },
          'team-2': {
            capacityRevision: 1,
            capacity: {
              version: 2,
              createdFromConfigVersion: 3,
              rows: { carol: row('carol', false) },
            },
            focusFactor: 0.75,
            focusFactorSource: 'bootstrap',
            focusFactorOverride: null,
            excludedFromCalibration: false,
            calibrationSkipReason: null,
          },
        },
        createdAt: 0,
        updatedAt: 0,
      },
    },
  };
}

/** v2 (pre-teams, not yet migrated) sprint data: one flat capacity at the entry's top level. */
function v2Data(start = '2026-07-22') {
  return {
    version: 2,
    sprints: {
      'S-1': {
        sequence: 1,
        name: 'Sprint 1',
        start,
        finish: '2026-08-04',
        capacityRevision: 1,
        capacity: {
          version: 2,
          createdFromConfigVersion: 1,
          rows: { alice: row('alice', false), bob: row('bob', true) },
        },
        focusFactor: 0.75,
        focusFactorSource: 'bootstrap',
        focusFactorOverride: null,
        excludedFromCalibration: false,
        calibrationSkipReason: null,
        createdAt: 0,
        updatedAt: 0,
      },
    },
  };
}

/** A stored v4 config envelope for a list of teams. */
function v4Config(teams: readonly unknown[]) {
  return { version: 4, revision: 1, config: { version: 4, teams } };
}

/** A stored legacy (v3-era) config envelope with project-level settings. */
function v3Config(config: Record<string, unknown>) {
  return { version: 3, revision: 1, config };
}

function project(data: unknown, config?: unknown, state?: unknown): WorkflowProject {
  const props: Record<string, string | undefined> = {
    scpSprintDataJson: JSON.stringify(data),
  };
  if (config !== undefined) props['scpConfigJson'] = JSON.stringify(config);
  if (state !== undefined) props['scpReminderStateJson'] = JSON.stringify(state);
  return { extensionProperties: props };
}

/** The default two-team v4 config matching {@link v4Data}. */
function twoTeamV4Config(
  team1Overrides: Record<string, unknown> = {},
  team2Overrides: Record<string, unknown> = {},
) {
  return v4Config([
    { ...makeTeam({ id: 'team-1', name: 'Alpha' }), ...team1Overrides },
    { ...makeTeam({ id: 'team-2', name: 'Beta', boardId: 'board-2' }), ...team2Overrides },
  ]);
}

function reminderState(p: WorkflowProject): { remindedOn: Record<string, string> } {
  return JSON.parse(p.extensionProperties['scpReminderStateJson']!) as {
    remindedOn: Record<string, string>;
  };
}

describe('rule registration', () => {
  it('registers a scheduled rule with a daily cron and muted notifications', () => {
    const { rule } = makeWorld([]);
    expect(typeof rule['cron']).toBe('string');
    expect(rule['muteUpdateNotifications']).toBe(true);
    expect(typeof rule['action']).toBe('function');
  });
});

describe('leadDaysOf', () => {
  it('accepts integers 0..30', () => {
    const { internals } = makeWorld([]);
    expect(internals.leadDaysOf(0)).toBe(0);
    expect(internals.leadDaysOf(3)).toBe(3);
    expect(internals.leadDaysOf(30)).toBe(30);
  });

  it('returns null for out-of-range, non-integer and non-numeric values', () => {
    const { internals } = makeWorld([]);
    expect(internals.leadDaysOf(-1)).toBeNull();
    expect(internals.leadDaysOf(31)).toBeNull();
    expect(internals.leadDaysOf(2.5)).toBeNull();
    expect(internals.leadDaysOf('soon')).toBeNull();
    expect(internals.leadDaysOf(undefined)).toBeNull();
    expect(internals.leadDaysOf({})).toBeNull();
  });
});

describe('capacityRowMaps', () => {
  it('collects the single top-level capacity from a v4 per-team entry', () => {
    const { internals } = makeWorld([]);
    const entry = teamSprintEntry({ alice: row('alice', false), bob: row('bob', true) });
    const maps = internals.capacityRowMaps(entry);
    expect(maps).toHaveLength(1);
    expect(Object.keys(maps[0]!).sort()).toEqual(['alice', 'bob']);
  });

  it('collects one row map per team from a v3 entry', () => {
    const { internals } = makeWorld([]);
    const entry = v3Data().sprints['S-1'] as unknown as Record<string, unknown>;
    const maps = internals.capacityRowMaps(entry);
    expect(maps).toHaveLength(2);
    expect(Object.keys(maps[0]!).sort()).toEqual(['alice', 'bob']);
    expect(Object.keys(maps[1]!)).toEqual(['carol']);
  });

  it('collects the single top-level capacity from a v2 entry', () => {
    const { internals } = makeWorld([]);
    const entry = v2Data().sprints['S-1'] as unknown as Record<string, unknown>;
    const maps = internals.capacityRowMaps(entry);
    expect(maps).toHaveLength(1);
    expect(Object.keys(maps[0]!).sort()).toEqual(['alice', 'bob']);
  });

  it('returns no maps for an entry without capacity', () => {
    const { internals } = makeWorld([]);
    expect(internals.capacityRowMaps({ name: 'S' })).toEqual([]);
    expect(internals.capacityRowMaps({ teams: { 'team-1': {} } })).toEqual([]);
  });
});

describe('reminderUnits', () => {
  it('builds per-team units keyed teamId/sprintId with each team lead days (v4)', () => {
    const { internals } = makeWorld([]);
    const config = twoTeamV4Config({ reminderLeadDays: 5 });
    const units = internals.reminderUnits(v4Data(), config, 3);
    expect(units.map((u) => u.key).sort()).toEqual(['team-1/S-1', 'team-2/S-1']);
    const byKey = new Map(units.map((u) => [u.key, u]));
    expect(byKey.get('team-1/S-1')!.leadDays).toBe(5); // team override
    expect(byKey.get('team-2/S-1')!.leadDays).toBe(3); // app fallback
    expect(byKey.get('team-1/S-1')!.rowMaps).toHaveLength(1);
    expect(Object.keys(byKey.get('team-2/S-1')!.rowMaps[0]!)).toEqual(['carol']);
  });

  it('omits stored teams that are missing from the config (v4)', () => {
    const { internals } = makeWorld([]);
    const config = v4Config([makeTeam({ id: 'team-1', name: 'Alpha' })]);
    const units = internals.reminderUnits(v4Data(), config, 3);
    expect(units.map((u) => u.key)).toEqual(['team-1/S-1']);
  });

  it('builds one unit per sprint with the project-level lead for v2/v3 documents', () => {
    const { internals } = makeWorld([]);
    const units3 = internals.reminderUnits(v3Data(), v3Config({ reminderLeadDays: 7 }), 3);
    expect(units3).toHaveLength(1);
    expect(units3[0]!.key).toBe('S-1');
    expect(units3[0]!.leadDays).toBe(7);
    expect(units3[0]!.rowMaps).toHaveLength(2);

    const units2 = internals.reminderUnits(v2Data(), null, 3);
    expect(units2).toHaveLength(1);
    expect(units2[0]!.key).toBe('S-1');
    expect(units2[0]!.leadDays).toBe(3);
    expect(units2[0]!.rowMaps).toHaveLength(1);
  });
});

describe('remindForProject', () => {
  it('notifies every non-customized row of every configured team for an upcoming sprint (v4)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v4Data(), twoTeamV4Config());
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login).sort()).toEqual(['alice', 'carol']); // bob customized
    expect(notifications[0]!.subject).toContain('Sprint 1');
  });

  it('notifies from a v3 (per-team inside shared entries) document as well', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    internals.remindForProject(project(v3Data()), 3, NOW);
    expect(notifications.map((n) => n.login).sort()).toEqual(['alice', 'carol']);
  });

  it('notifies from a v2 (pre-teams) document as well', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    internals.remindForProject(project(v2Data()), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('stamps scpReminderStateJson keyed teamId/sprintId and never re-notifies for the same day (v4)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v4Data(), twoTeamV4Config());
    internals.remindForProject(p, 3, NOW);
    const state = reminderState(p);
    expect(state.remindedOn['team-1/S-1']).toBe('2026-07-20');
    expect(state.remindedOn['team-2/S-1']).toBe('2026-07-20');
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toHaveLength(2); // unchanged
  });

  it('stamps plain sprintId keys for legacy v3 documents and never re-notifies', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data());
    internals.remindForProject(p, 3, NOW);
    expect(reminderState(p).remindedOn['S-1']).toBe('2026-07-20');
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toHaveLength(2); // unchanged
  });

  it('does nothing when the sprint start is outside the lead window', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    const p = project(v2Data('2026-07-27')); // 7 days out, lead 3
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toEqual([]);
    expect(p.extensionProperties['scpReminderStateJson']).toBeUndefined();
  });

  it('does not remind for a sprint that already started', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    internals.remindForProject(project(v2Data('2026-07-19')), 3, NOW);
    expect(notifications).toEqual([]);
  });

  it('lets a team reminderLeadDays widen the window past the app setting (v4)', () => {
    const { internals, notifications } = makeWorld(['alice']);
    const data = {
      version: 4,
      teams: {
        'team-1': {
          sprints: { 'S-1': teamSprintEntry({ alice: row('alice', false) }, '2026-07-27') },
        },
      },
    };
    const p = project(data, v4Config([makeTeam({ id: 'team-1', reminderLeadDays: 10 })]));
    internals.remindForProject(p, 3, NOW); // 7 days out, app lead 3, team lead 10
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('lets the legacy project-level reminderLeadDays widen the window past the app setting', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    const p = project(v2Data('2026-07-27'), v3Config({ reminderLeadDays: 10 }));
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('treats a team reminderLeadDays of 0 as DISABLED for that team only (v4)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v4Data(), twoTeamV4Config({ reminderLeadDays: 0 }));
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['carol']); // team-1 muted, team-2 not
    const state = reminderState(p);
    expect(state.remindedOn['team-1/S-1']).toBeUndefined();
    expect(state.remindedOn['team-2/S-1']).toBe('2026-07-20');
  });

  it('treats a legacy project reminderLeadDays of 0 as DISABLED — no notifications, no stamp', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data(), v3Config({ reminderLeadDays: 0 }));
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toEqual([]);
    expect(p.extensionProperties['scpReminderStateJson']).toBeUndefined();
  });

  it('falls back to the app lead when a team has an invalid reminderLeadDays (v4)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v4Data(), twoTeamV4Config({ reminderLeadDays: 99 })); // out of range
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login).sort()).toEqual(['alice', 'carol']);
  });

  it('falls back to the app lead when a legacy config has no valid override', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    internals.remindForProject(project(v2Data(), v3Config({})), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('never reminds stored teams that were removed from the config (v4)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    // Storage retains team-2, but the config only knows team-1.
    const p = project(v4Data(), v4Config([makeTeam({ id: 'team-1', name: 'Alpha' })]));
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
    expect(reminderState(p).remindedOn['team-2/S-1']).toBeUndefined();
  });

  it('reminds nobody from a v4 document when the project has no config at all', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v4Data());
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toEqual([]);
    expect(p.extensionProperties['scpReminderStateJson']).toBeUndefined();
  });

  it('ignores unknown data-document versions and malformed v4 documents', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    internals.remindForProject(project({ ...v2Data(), version: 1 }), 3, NOW);
    internals.remindForProject(project({ ...v4Data(), version: 5 }, twoTeamV4Config()), 3, NOW);
    // v4-stamped but with a v3 shape (no team-first map) — never a valid document.
    internals.remindForProject(project({ ...v3Data(), version: 4 }, twoTeamV4Config()), 3, NOW);
    expect(notifications).toEqual([]);
  });

  it('prunes v4 stamps for team sprints that vanished or already started', () => {
    const { internals } = makeWorld(['alice', 'bob', 'carol']);
    const data = v4Data();
    // team-2 also has a sprint that already started.
    (data.teams['team-2'].sprints as Record<string, unknown>)['S-0'] = teamSprintEntry(
      { carol: row('carol', false) },
      '2026-07-06',
      '2026-07-19',
    );
    const p = project(data, twoTeamV4Config(), {
      version: 1,
      remindedOn: {
        'team-1/S-gone': '2026-07-10', // sprint no longer stored
        'team-2/S-0': '2026-07-06', // sprint already started
        'team-1/S-1': '2026-07-19', // still upcoming — re-stamped today
      },
    });
    internals.remindForProject(p, 3, NOW);
    const state = reminderState(p);
    expect(state.remindedOn['team-1/S-gone']).toBeUndefined();
    expect(state.remindedOn['team-2/S-0']).toBeUndefined();
    expect(state.remindedOn['team-1/S-1']).toBe('2026-07-20');
  });

  it('prunes legacy v3 stamps for sprints that vanished or already started', () => {
    const { internals } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data(), undefined, {
      version: 1,
      remindedOn: { 'S-gone': '2026-07-10', 'S-1': '2026-07-19' },
    });
    internals.remindForProject(p, 3, NOW);
    const state = reminderState(p);
    expect(state.remindedOn['S-gone']).toBeUndefined(); // no such sprint anymore
    expect(state.remindedOn['S-1']).toBe('2026-07-20'); // re-stamped for today
  });

  it('skips logins the user directory cannot resolve', () => {
    const { internals, notifications } = makeWorld(['carol']); // alice unknown
    internals.remindForProject(project(v4Data(), twoTeamV4Config()), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['carol']);
  });
});
