import { describe, it, expect } from 'vitest';
import { buildSprintView, type IssueLike, type NativeSprintLike } from '../../src/widgets/sprint-view.js';
import type { Team } from '../../src/shared/types.js';
import { makeDoc, makeParticipant, makeRow, makeTeam, makeTeamSprint } from '../fixtures/capacity.js';

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

/** Alpha's stored entry: raw 4800 @ 0.5 → planned 2400. */
function alphaEntry() {
  return makeTeamSprint({
    name: NATIVE.name,
    start: NATIVE.start!,
    finish: NATIVE.finish!,
    capacityRevision: 3,
    capacity: makeDoc([makeRow({ userId: 'alice', availableMinutes: 4800 })]),
    focusFactor: 0.5,
  });
}

/** Beta's stored entry: raw 2400 @ 0.8 → planned 1920. */
function betaEntry() {
  return makeTeamSprint({
    name: NATIVE.name,
    start: NATIVE.start!,
    finish: NATIVE.finish!,
    capacity: makeDoc([makeRow({ userId: 'bob', defaultMinutes: 2400, availableMinutes: 2400 })]),
    focusFactor: 0.8,
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
    // Unassigned: belongs to no member, counts only in the Sprint totals.
    issue({ id: 'AGP-4', originalEffortMinutes: 100, currentEffortMinutes: 100 }),
    // Assigned outside the team: Sprint totals only, not in the team slice.
    issue({ id: 'AGP-5', originalEffortMinutes: 50, currentEffortMinutes: 50, assigneeLogin: 'zoe' }),
  ];

  it('filters the team slice to issues assigned to its members (enabled or not)', () => {
    const view = buildSprintView(NATIVE, alphaEntry(), ALPHA, issues, DURING);
    expect(view.team.teamId).toBe('team-a');
    expect(view.team.teamName).toBe('Alpha');
    expect(view.team.originalEffortMinutes).toBe(800); // alice 600 + dan 200
    expect(Object.keys(view.team.assignedEffort).sort()).toEqual(['alice', 'dan']);
    expect(view.team.unresolvedIssueCount).toBe(2);

    const betaView = buildSprintView(NATIVE, betaEntry(), BETA, issues, DURING);
    expect(betaView.team.originalEffortMinutes).toBe(300);
    expect(Object.keys(betaView.team.assignedEffort)).toEqual(['bob']);
  });

  it('keeps unassigned and outside-team effort in the Sprint totals only', () => {
    const view = buildSprintView(NATIVE, alphaEntry(), ALPHA, issues, DURING);
    expect(view.originalEffortMinutes).toBe(1250); // 600+300+200+100+50
    expect(view.currentEffortMinutes).toBe(1070); // 600+120+200+100+50
    expect(view.unassignedEffort).toEqual({ originalEffortMinutes: 100, currentEffortMinutes: 100 });
    // AGP-2 (bob), AGP-4 (unassigned) and AGP-5 (zoe) stay out of the team slice.
    expect(view.team.originalEffortMinutes).toBe(800);
    expect(view.unresolvedIssueCount).toBe(5);
    expect(view.team.unresolvedIssueCount).toBe(2);
  });

  it("uses the team's capacity for the Sprint totals, planned with the team's own focus factor", () => {
    const alpha = buildSprintView(NATIVE, alphaEntry(), ALPHA, issues, DURING);
    expect(alpha.team.rawCapacityMinutes).toBe(4800);
    expect(alpha.team.plannedCapacityMinutes).toBe(2400);
    expect(alpha.rawCapacityMinutes).toBe(4800); // Sprint-level capacity IS the team's
    expect(alpha.plannedCapacityMinutes).toBe(2400);

    // Another team's view of its own Sprint plans with ITS focus factor.
    const beta = buildSprintView(NATIVE, betaEntry(), BETA, issues, DURING);
    expect(beta.rawCapacityMinutes).toBe(2400);
    expect(beta.plannedCapacityMinutes).toBe(1920);
  });

  it("counts a SHARED member's issue in EACH team's own view, but once per view totals", () => {
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
    const alpha = buildSprintView(NATIVE, alphaEntry(), alphaShared, shared, DURING);
    const beta = buildSprintView(NATIVE, betaEntry(), betaShared, shared, DURING);
    expect(alpha.team.originalEffortMinutes).toBe(500); // sam 400 + alice 100
    expect(beta.team.originalEffortMinutes).toBe(400); // sam 400 again — attributed to both views
    expect(alpha.team.assignedEffort['sam']!.originalEffortMinutes).toBe(400);
    expect(beta.team.assignedEffort['sam']!.originalEffortMinutes).toBe(400);
    // Each view's Sprint totals count each issue exactly once, no double counting.
    expect(alpha.originalEffortMinutes).toBe(500);
    expect(alpha.currentEffortMinutes).toBe(500);
    expect(beta.originalEffortMinutes).toBe(500);
    expect(alpha.unresolvedIssueCount).toBe(2);
  });

  it("derives the Sprint observed factor from ALL completed effort over the team's raw capacity", () => {
    const resolved = [
      issue({ id: 'AGP-6', originalEffortMinutes: 2400, resolved: true, resolvedAt: DURING, assigneeLogin: 'alice' }),
      issue({ id: 'AGP-7', originalEffortMinutes: 1200, resolved: true, resolvedAt: DURING }), // unassigned
    ];
    const view = buildSprintView(NATIVE, alphaEntry(), ALPHA, resolved, DURING);
    expect(view.completedOriginalEffortMinutes).toBe(3600);
    expect(view.observedFocusFactor).toBeCloseTo(3600 / 4800); // includes unassigned work
    // The team slice's observed factor uses only the team's own issues and capacity.
    expect(view.team.completedOriginalEffortMinutes).toBe(2400);
    expect(view.team.observedFocusFactor).toBeCloseTo(2400 / 4800);

    // A team that completed none of the resolved work observes 0 against its capacity.
    const beta = buildSprintView(NATIVE, betaEntry(), BETA, resolved, DURING);
    expect(beta.team.observedFocusFactor).toBe(0); // 0 / 2400
  });
});

describe('buildSprintView — entry presence', () => {
  it('assembles a managed view with sequence and the team stored state', () => {
    const view = buildSprintView(NATIVE, alphaEntry(), ALPHA, [], DURING);
    expect(view.managed).toBe(true);
    expect(view.sequence).toBe(1);
    expect(view.team.capacityRevision).toBe(3);
    expect(view.team.focusFactor).toBe(0.5);
    expect(view.completion).toBeNull(); // not yet past the finish day
  });

  it('reflects the NATIVE Sprint fields even when the stored entry is stale', () => {
    const stale = { ...alphaEntry(), name: 'Old name', start: '2025-12-01', finish: '2025-12-14' };
    const view = buildSprintView(NATIVE, stale, ALPHA, [], DURING);
    expect(view.name).toBe(NATIVE.name);
    expect(view.start).toBe(NATIVE.start);
    expect(view.finish).toBe(NATIVE.finish);
    expect(view.rawCapacityMinutes).toBe(4800); // stored capacity still counts
  });

  it('produces an unmanaged, zero-capacity empty view at capacityRevision 0 when there is no entry', () => {
    const view = buildSprintView(NATIVE, null, ALPHA, [], DURING);
    expect(view.managed).toBe(false);
    expect(view.sequence).toBe(0);
    expect(view.team.teamId).toBe('team-a');
    expect(view.team.capacityRevision).toBe(0);
    expect(view.team.capacity.rows).toEqual({});
    expect(view.team.rawCapacityMinutes).toBe(0);
    expect(view.rawCapacityMinutes).toBe(0);
    expect(view.team.focusFactor).toBe(0.75); // bootstrap default
    expect(view.team.focusFactorSource).toBe('bootstrap');
    expect(view.observedFocusFactor).toBeNull(); // no capacity to observe against
  });
});

describe('buildSprintView — completion', () => {
  it('includes a completion snapshot only once the finish day has passed', () => {
    const issues = [
      issue({ id: 'AGP-1', originalEffortMinutes: 2400, resolved: true, resolvedAt: DURING, assigneeLogin: 'alice' }),
    ];
    const during = buildSprintView(NATIVE, alphaEntry(), ALPHA, issues, Date.UTC(2026, 0, 18, 12));
    expect(during.completion).toBeNull(); // still within the finish day

    const after = buildSprintView(NATIVE, alphaEntry(), ALPHA, issues, Date.UTC(2026, 0, 19));
    expect(after.completion).not.toBeNull();
    expect(after.completion!.completedOriginalEffortMinutes).toBe(2400);
    expect(after.completion!.rawCapacityMinutes).toBe(4800);
    expect(after.observedFocusFactor).toBeCloseTo(2400 / 4800);
  });
});
