/**
 * Pure assembly of the client-facing {@link SprintView} from native Sprint data, the
 * team's stored {@link TeamSprint} entry, the owning {@link Team} and the current
 * issue set. Metrics are computed live here (compute-on-read) with the shared domain
 * math — there is no cached copy to go stale.
 *
 * Since config v4 a Sprint view belongs to exactly ONE team (each team plans on its
 * own board). Team attribution: an issue belongs to the team when its assignee is a
 * team member (see {@link ../domain/teams/teams.ts}); unassigned issues belong to no
 * member and only count in the Sprint totals. A Sprint not yet managed by the team
 * (no entry) gets an empty view with capacityRevision 0 — the backend materializes
 * the entry lazily on the first write with the same revision, so optimistic
 * concurrency stays coherent.
 */
import {
  DEFAULT_FOCUS_FACTOR,
  buildCompletion,
  computeMetrics,
  isCompletedSprint,
  teamMemberLogins,
  type EffortIssue,
} from '../domain/index.js';
import type { AssigneeEffortView, IssueView, SprintView, TeamSprintView } from '../shared/api.js';
import type { CapacityDocument, Team, TeamSprint } from '../shared/types.js';

const EMPTY_CAPACITY: CapacityDocument = { version: 2, createdFromConfigVersion: 0, rows: {} };

/** Native Sprint fields the view needs (structurally satisfied by the REST client's YtSprint). */
export interface NativeSprintLike {
  id: string;
  name: string;
  goal: string;
  start: string | null;
  finish: string | null;
  archived: boolean;
}

/** Issue fields the view needs (structurally satisfied by the REST client's YtIssue). */
export interface IssueLike {
  id: string;
  idReadable?: string | undefined;
  summary?: string | undefined;
  originalEffortMinutes: number | null;
  currentEffortMinutes: number | null;
  resolved: boolean;
  resolvedAt: number | null;
  assigneeLogin: string | null;
  assigneeName: string | null;
}

export function toEffortIssue(issue: IssueLike): EffortIssue {
  return {
    id: issue.id,
    originalEffortMinutes: issue.originalEffortMinutes,
    currentEffortMinutes: issue.currentEffortMinutes,
    resolved: issue.resolved,
    resolvedAt: issue.resolvedAt,
    assigneeId: issue.assigneeLogin,
  };
}

export function toIssueView(issue: IssueLike): IssueView {
  return {
    id: issue.id,
    idReadable: issue.idReadable ?? issue.id,
    summary: issue.summary ?? '',
    assigneeId: issue.assigneeLogin,
    assigneeName: issue.assigneeName,
    originalEffortMinutes: issue.originalEffortMinutes,
    currentEffortMinutes: issue.currentEffortMinutes,
    resolved: issue.resolved,
  };
}

const ZERO_EFFORT: AssigneeEffortView = { originalEffortMinutes: 0, currentEffortMinutes: 0 };

/** The team's slice: stored planning state + metrics over the team's issues. */
function buildTeamView(
  team: Team,
  entry: TeamSprint | null,
  teamIssues: readonly EffortIssue[],
  start: string,
  finish: string,
): TeamSprintView {
  const focusFactor = entry?.focusFactor ?? DEFAULT_FOCUS_FACTOR;
  const metrics = computeMetrics(entry?.capacity ?? null, teamIssues, start, finish, focusFactor);
  return {
    teamId: team.id,
    teamName: team.name,
    capacityRevision: entry?.capacityRevision ?? 0,
    capacity: entry?.capacity ?? EMPTY_CAPACITY,
    focusFactor,
    focusFactorSource: entry?.focusFactorSource ?? 'bootstrap',
    focusFactorOverride: entry?.focusFactorOverride ?? null,
    excludedFromCalibration: entry?.excludedFromCalibration ?? false,
    calibrationSkipReason: entry?.calibrationSkipReason ?? null,
    rawCapacityMinutes: metrics.rawCapacityMinutes,
    plannedCapacityMinutes: metrics.plannedCapacityMinutes,
    originalEffortMinutes: metrics.originalEffortMinutes,
    currentEffortMinutes: metrics.currentEffortMinutes,
    completedOriginalEffortMinutes: metrics.completedOriginalEffortMinutes,
    observedFocusFactor: metrics.observedFocusFactor,
    assignedEffort: metrics.assignedEffort,
    unresolvedIssueCount: metrics.unresolvedIssueCount,
  };
}

/** Assemble the client-facing view from native data + the team's state, computing metrics live. */
export function buildSprintView(
  native: NativeSprintLike,
  entry: TeamSprint | null,
  team: Team,
  issues: readonly IssueLike[],
  nowMs: number,
): SprintView {
  const hasDates = native.start !== null && native.finish !== null;
  const start = native.start ?? '1970-01-01';
  const finish = native.finish ?? '1970-01-02';
  const effortIssues = hasDates ? issues.map(toEffortIssue) : [];

  const logins = teamMemberLogins(team);
  const teamIssues = effortIssues.filter(
    (i) => i.assigneeId !== null && i.assigneeId !== undefined && logins.has(i.assigneeId),
  );
  const teamView = buildTeamView(team, entry, teamIssues, start, finish);

  // Sprint totals: capacity is the team's; effort aggregates ALL issues in the
  // native Sprint, so work assigned outside the team and unassigned work still
  // show up at the Sprint level. The observed factor (and completion) therefore
  // measures everything the Sprint delivered against the team's capacity.
  const allEffort = computeMetrics(
    entry?.capacity ?? null,
    effortIssues,
    start,
    finish,
    teamView.focusFactor,
  );
  const completed = hasDates && isCompletedSprint(finish, nowMs);

  return {
    id: native.id,
    name: native.name,
    goal: native.goal,
    start: native.start ?? '',
    finish: native.finish ?? '',
    archived: native.archived,
    managed: entry !== null,
    sequence: entry?.sequence ?? 0,
    team: teamView,
    rawCapacityMinutes: allEffort.rawCapacityMinutes,
    plannedCapacityMinutes: allEffort.plannedCapacityMinutes,
    originalEffortMinutes: allEffort.originalEffortMinutes,
    currentEffortMinutes: allEffort.currentEffortMinutes,
    completedOriginalEffortMinutes: allEffort.completedOriginalEffortMinutes,
    observedFocusFactor: allEffort.observedFocusFactor,
    computedAt: nowMs,
    completion: completed ? buildCompletion(allEffort, start, finish, nowMs) : null,
    issuesMissingOriginalEffort: allEffort.issuesMissingOriginalEffort,
    unassignedEffort: allEffort.unassignedEffort ?? ZERO_EFFORT,
    unresolvedIssueCount: allEffort.unresolvedIssueCount,
  };
}
