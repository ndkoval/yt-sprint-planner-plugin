/**
 * Unit tests for the availability-reminder workflow's exported _internals.
 *
 * The workflow is a CommonJS module written for YouTrack's scripting runtime; it is
 * evaluated here inside a CommonJS-style wrapper with a stubbed
 * `@jetbrains/youtrack-scripting-api/entities`, so `Issue.onSchedule` registration and
 * `User.findByLogin` notifications run against test doubles.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface WorkflowInternals {
  remindForProject(project: WorkflowProject, appLeadDays: number, nowMs: number): void;
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

/** v3 sprint data: an upcoming sprint (starts in 2 days) with two teams. */
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

/** v2 (pre-teams) sprint data: one flat capacity at the entry's top level. */
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

function project(data: unknown, config?: unknown, state?: unknown): WorkflowProject {
  const props: Record<string, string | undefined> = {
    scpSprintDataJson: JSON.stringify(data),
  };
  if (config !== undefined) props['scpConfigJson'] = JSON.stringify({ version: 3, revision: 1, config });
  if (state !== undefined) props['scpReminderStateJson'] = JSON.stringify(state);
  return { extensionProperties: props };
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

describe('remindForProject', () => {
  it('notifies every non-customized row of every team for an upcoming sprint (v3)', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data());
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login).sort()).toEqual(['alice', 'carol']); // bob customized
    expect(notifications[0]!.subject).toContain('Sprint 1');
  });

  it('notifies from a v2 (pre-teams) document as well', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    internals.remindForProject(project(v2Data()), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('stamps scpReminderStateJson and never re-notifies for the same day', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data());
    internals.remindForProject(p, 3, NOW);
    const state = JSON.parse(p.extensionProperties['scpReminderStateJson']!) as {
      remindedOn: Record<string, string>;
    };
    expect(state.remindedOn['S-1']).toBe('2026-07-20');
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

  it('lets the project config reminderLeadDays widen the window past the app setting', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    const p = project(v2Data('2026-07-27'), { reminderLeadDays: 10 });
    internals.remindForProject(p, 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('treats a project reminderLeadDays of 0 as DISABLED — no notifications, no stamp', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data(), { reminderLeadDays: 0 });
    internals.remindForProject(p, 3, NOW);
    expect(notifications).toEqual([]);
    expect(p.extensionProperties['scpReminderStateJson']).toBeUndefined();
  });

  it('falls back to the app lead when the config has no valid override', () => {
    const { internals, notifications } = makeWorld(['alice', 'bob']);
    internals.remindForProject(project(v2Data(), {}), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['alice']);
  });

  it('requires a data document at version 2 or 3', () => {
    const { internals, notifications } = makeWorld(['alice']);
    internals.remindForProject(project({ ...v3Data(), version: 4 }), 3, NOW);
    internals.remindForProject(project({ ...v2Data(), version: 1 }), 3, NOW);
    expect(notifications).toEqual([]);
  });

  it('prunes stamps for sprints that vanished or already started', () => {
    const { internals } = makeWorld(['alice', 'bob', 'carol']);
    const p = project(v3Data(), undefined, {
      version: 1,
      remindedOn: { 'S-gone': '2026-07-10', 'S-1': '2026-07-19' },
    });
    internals.remindForProject(p, 3, NOW);
    const state = JSON.parse(p.extensionProperties['scpReminderStateJson']!) as {
      remindedOn: Record<string, string>;
    };
    expect(state.remindedOn['S-gone']).toBeUndefined(); // no such sprint anymore
    expect(state.remindedOn['S-1']).toBe('2026-07-20'); // re-stamped for today
  });

  it('skips logins the user directory cannot resolve', () => {
    const { internals, notifications } = makeWorld(['carol']); // alice unknown
    internals.remindForProject(project(v3Data()), 3, NOW);
    expect(notifications.map((n) => n.login)).toEqual(['carol']);
  });
});
