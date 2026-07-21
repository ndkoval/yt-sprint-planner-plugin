import { describe, it, expect } from 'vitest';
import { buildSprintView, type IssueLike, type NativeSprintLike } from '../../src/widgets/sprint-view.js';
import type { Team } from '../../src/shared/types.js';
import { makeDoc, makeParticipant, makeRow, makeSprintEntry, makeTeam, makeTeamEntry } from '../fixtures/capacity.js';

const NATIVE: NativeSprintLike = {
  id: '207-1',
  name: 'Sprint 1',
  goal: 'ship it',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

// Alpha: alice (enabled) + dan (DISABLED — still a member for issue attribution).
const ALPHA: Team = makeTeam({
  id: 'team-a',
  name: 'Alpha',
  participants: [makeParticipant('alice'), makeParticipant('dan', { enabled: false })],
});
const BETA: Team = makeTeam({ id: 'team-b', name: 'Beta', participants: [makeParticipant('bob')] });

/** Alpha raw 4800 @ 0.5, Beta raw 2400 @ 0.8 → planned 2400 + 1920. */
function entry() {
  return makeSprintEntry({
    name: NATIVE.name,
    start: NATIVE.start!,
    finish: NATIVE.finish!,
    teams: {
      'team-a': makeTeamEntry({
        capacityRevision: 3,
        capacity: makeDoc([makeRow({ userId: 'alice', availableMinutes: 4800 })]),
        focusFactor: 0.5,
      }),
      'team-b': makeTeamEntry({
        capacity: makeDoc([makeRow({ userId: 'bob', defaultMinutes: 2400, availableMinutes: 2400 })]),
        focusFactor: 0.8,
      }),
    },
  });
}

function issue(overrides: Partial<IssueLike>): IssueLike {
  return {
    id: 'AGP-1',
    originalEffortMinutes: null,
    currentEffortMinutes: null,
    resolved: false,
    resolvedAt: null,
    assigneeLogin: null,
    assigneeName: null,
    ...overrides,
  };
}

const DURING = Date.UTC(2026, 0, 10);

describe('buildSprintView — team attribution', () => {
  const issues = [
    issue({ id: 'AGP-1', originalEffortMinutes: 600, currentEffortMinutes: 600, assigneeLogin: 'alice' }),
    issue({ id: 'AGP-2', originalEffortMinutes: 300, currentEffortMinutes: 120, assigneeLogin: 'bob' }),
    // dan is a DISABLED member of Alpha — membership, not enablement, attributes issues.
    issue({ id: 'AGP-3', originalEffortMinutes: 200, currentEffortMinutes: 200, assigneeLogin: 'dan' }),
    // Unassigned: belongs to no team, counts only in the Sprint totals.
    issue({ id: 'AGP-4', originalEffortMinutes: 100, currentEffortMinutes: 100 }),
    // Assigned outside every team: Sprint totals only, no team.
    issue({ id: 'AGP-5', originalEffortMinutes: 50, currentEffortMinutes: 50, assigneeLogin: 'zoe' }),
  ];

  it('filters each team metrics to issues assigned to its members (enabled or not)', () => {
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA], issues, DURING);
    const [alpha, beta] = view.teams;
    expect(alpha!.teamId).toBe('team-a');
    expect(alpha!.teamName).toBe('Alpha');
    expect(alpha!.originalEffortMinutes).toBe(800); // alice 600 + dan 200
    expect(Object.keys(alpha!.assignedEffort).sort()).toEqual(['alice', 'dan']);
    expect(alpha!.unresolvedIssueCount).toBe(2);
    expect(beta!.originalEffortMinutes).toBe(300);
    expect(Object.keys(beta!.assignedEffort)).toEqual(['bob']);
  });

  it('keeps unassigned and outside-team effort in the Sprint totals only', () => {
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA], issues, DURING);
    expect(view.originalEffortMinutes).toBe(1250); // 600+300+200+100+50
    expect(view.currentEffortMinutes).toBe(1070); // 600+120+200+100+50
    expect(view.unassignedEffort).toEqual({ originalEffortMinutes: 100, currentEffortMinutes: 100 });
    const teamTotal = view.teams.reduce((s, t) => s + t.originalEffortMinutes, 0);
    expect(teamTotal).toBe(1100); // AGP-4 (unassigned) and AGP-5 (zoe) are in no team
    expect(view.unresolvedIssueCount).toBe(5);
  });

  it('sums Sprint capacity totals over teams, each planned with its own focus factor', () => {
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA], issues, DURING);
    expect(view.teams.map((t) => t.rawCapacityMinutes)).toEqual([4800, 2400]);
    expect(view.teams.map((t) => t.plannedCapacityMinutes)).toEqual([2400, 1920]);
    expect(view.rawCapacityMinutes).toBe(7200);
    expect(view.plannedCapacityMinutes).toBe(4320);
  });

  it('counts an issue of a SHARED member toward BOTH teams, but once in the totals', () => {
    // sam is a member of both Alpha and Beta (shared specialist).
    const alphaShared: Team = {
      ...ALPHA,
      participants: [...ALPHA.participants, makeParticipant('sam', { allocation: 0.5 })],
    };
    const betaShared: Team = {
      ...BETA,
      participants: [...BETA.participants, makeParticipant('sam', { allocation: 0.5 })],
    };
    const shared = [
      issue({ id: 'AGP-8', originalEffortMinutes: 400, currentEffortMinutes: 400, assigneeLogin: 'sam' }),
      issue({ id: 'AGP-9', originalEffortMinutes: 100, currentEffortMinutes: 100, assigneeLogin: 'alice' }),
    ];
    const view = buildSprintView(NATIVE, entry(), [alphaShared, betaShared], shared, DURING);
    const [alpha, beta] = view.teams;
    expect(alpha!.originalEffortMinutes).toBe(500); // sam 400 + alice 100
    expect(beta!.originalEffortMinutes).toBe(400); // sam 400 again — attributed to both
    expect(alpha!.assignedEffort['sam']!.originalEffortMinutes).toBe(400);
    expect(beta!.assignedEffort['sam']!.originalEffortMinutes).toBe(400);
    // Sprint totals count each issue exactly once, no double counting.
    expect(view.originalEffortMinutes).toBe(500);
    expect(view.currentEffortMinutes).toBe(500);
    expect(view.unresolvedIssueCount).toBe(2);
  });

  it('derives the Sprint observed factor from ALL completed effort over the raw sum', () => {
    const resolved = [
      issue({ id: 'AGP-6', originalEffortMinutes: 2400, resolved: true, resolvedAt: DURING, assigneeLogin: 'alice' }),
      issue({ id: 'AGP-7', originalEffortMinutes: 1200, resolved: true, resolvedAt: DURING }), // unassigned
    ];
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA], resolved, DURING);
    expect(view.completedOriginalEffortMinutes).toBe(3600);
    expect(view.observedFocusFactor).toBeCloseTo(0.5); // 3600 / 7200 — includes unassigned work
    // Per-team observed uses only the team's own issues and capacity.
    expect(view.teams[0]!.observedFocusFactor).toBeCloseTo(0.5); // 2400 / 4800
    expect(view.teams[1]!.observedFocusFactor).toBe(0);
  });
});

describe('buildSprintView — entry/team presence', () => {
  it('assembles a managed view with sequence and per-team stored state', () => {
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA], [], DURING);
    expect(view.managed).toBe(true);
    expect(view.sequence).toBe(1);
    expect(view.teams[0]!.capacityRevision).toBe(3);
    expect(view.teams[0]!.focusFactor).toBe(0.5);
    expect(view.completion).toBeNull(); // not yet past the finish day
  });

  it('gives a config team missing from the entry an empty view at capacityRevision 0', () => {
    const gamma = makeTeam({ id: 'team-c', name: 'Gamma', participants: [makeParticipant('carol')] });
    const view = buildSprintView(NATIVE, entry(), [ALPHA, BETA, gamma], [], DURING);
    const empty = view.teams[2]!;
    expect(empty.teamId).toBe('team-c');
    expect(empty.capacityRevision).toBe(0);
    expect(empty.capacity.rows).toEqual({});
    expect(empty.rawCapacityMinutes).toBe(0);
    expect(empty.focusFactor).toBe(0.75); // bootstrap default
    expect(empty.focusFactorSource).toBe('bootstrap');
  });

  it('hides entry teams that are no longer in the config from the view and totals', () => {
    const view = buildSprintView(NATIVE, entry(), [ALPHA], [], DURING);
    expect(view.teams.map((t) => t.teamId)).toEqual(['team-a']);
    expect(view.rawCapacityMinutes).toBe(4800); // Beta's stored 2400 is not counted
  });

  it('produces an unmanaged, zero-capacity view when there is no app entry', () => {
    const view = buildSprintView(NATIVE, null, [ALPHA], [], DURING);
    expect(view.managed).toBe(false);
    expect(view.sequence).toBe(0);
    expect(view.rawCapacityMinutes).toBe(0);
    expect(view.teams[0]!.focusFactor).toBe(0.75); // bootstrap default
    expect(view.teams[0]!.capacity.rows).toEqual({});
  });
});

describe('buildSprintView — completion', () => {
  it('includes a completion snapshot only once the finish day has passed', () => {
    const issues = [
      issue({ id: 'AGP-1', originalEffortMinutes: 2400, resolved: true, resolvedAt: DURING, assigneeLogin: 'alice' }),
    ];
    const during = buildSprintView(NATIVE, entry(), [ALPHA, BETA], issues, Date.UTC(2026, 0, 18, 12));
    expect(during.completion).toBeNull(); // still within the finish day

    const after = buildSprintView(NATIVE, entry(), [ALPHA, BETA], issues, Date.UTC(2026, 0, 19));
    expect(after.completion).not.toBeNull();
    expect(after.completion!.completedOriginalEffortMinutes).toBe(2400);
    expect(after.completion!.rawCapacityMinutes).toBe(7200);
    expect(after.observedFocusFactor).toBeCloseTo(2400 / 7200);
  });
});
