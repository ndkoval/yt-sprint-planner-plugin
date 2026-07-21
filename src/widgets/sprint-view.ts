/**
 * Pure assembly of the client-facing {@link SprintView} from native Sprint data, the
 * app's stored {@link SprintEntry}, the config's teams and the current issue set.
 * Metrics are computed live here (compute-on-read) with the shared domain math —
 * there is no cached copy to go stale.
 *
 * Team attribution: an issue belongs to the team its assignee is a member of
 * (see {@link ../domain/teams/teams.ts}); unassigned issues belong to no team and
 * only count in the Sprint totals. Teams present in the config but missing from the
 * entry (added after registration) get an empty view with capacityRevision 0 — the
 * backend materializes them lazily on the first write with the same revision, so
 * optimistic concurrency stays coherent. Entry teams no longer in the config
 * (deleted teams) are retained in storage but hidden here.
 */
import {
  DEFAULT_FOCUS_FACTOR,
  buildCompletion,
  computeMetrics,
  isCompletedSprint,
  observedFocusFactor,
  teamMemberLogins,
  type EffortIssue,
} from '../domain/index.js';
import type { AssigneeEffortView, IssueView, SprintView, TeamSprintView } from '../shared/api.js';
import type { CapacityDocument, SprintEntry, Team } from '../shared/types.js';

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

/** One team's slice: stored planning state + metrics over the team's issues. */
function buildTeamView(
  team: Team,
  entry: SprintEntry | null,
  teamIssues: readonly EffortIssue[],
  start: string,
  finish: string,
): TeamSprintView {
  const teamEntry = entry?.teams[team.id] ?? null;
  const focusFactor = teamEntry?.focusFactor ?? DEFAULT_FOCUS_FACTOR;
  const metrics = computeMetrics(teamEntry?.capacity ?? null, teamIssues, start, finish, focusFactor);
  return {
    teamId: team.id,
    teamName: team.name,
    capacityRevision: teamEntry?.capacityRevision ?? 0,
    capacity: teamEntry?.capacity ?? EMPTY_CAPACITY,
    focusFactor,
    focusFactorSource: teamEntry?.focusFactorSource ?? 'bootstrap',
    focusFactorOverride: teamEntry?.focusFactorOverride ?? null,
    excludedFromCalibration: teamEntry?.excludedFromCalibration ?? false,
    calibrationSkipReason: teamEntry?.calibrationSkipReason ?? null,
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

/** Assemble the client-facing view from native data + app state, computing metrics live. */
export function buildSprintView(
  native: NativeSprintLike,
  entry: SprintEntry | null,
  teams: readonly Team[],
  issues: readonly IssueLike[],
  nowMs: number,
): SprintView {
  const hasDates = native.start !== null && native.finish !== null;
  const start = native.start ?? '1970-01-01';
  const finish = native.finish ?? '1970-01-02';
  const effortIssues = hasDates ? issues.map(toEffortIssue) : [];

  const teamViews = teams.map((team) => {
    const logins = teamMemberLogins(team);
    const teamIssues = effortIssues.filter(
      (i) => i.assigneeId !== null && i.assigneeId !== undefined && logins.has(i.assigneeId),
    );
    return buildTeamView(team, entry, teamIssues, start, finish);
  });

  // Sprint totals: capacity is the sum over teams (each planned with its own Focus
  // Factor); effort aggregates ALL issues, so work assigned outside every team and
  // unassigned work still show up at the Sprint level.
  const rawTotal = teamViews.reduce((sum, t) => sum + t.rawCapacityMinutes, 0);
  const plannedTotal = teamViews.reduce((sum, t) => sum + t.plannedCapacityMinutes, 0);
  const allEffort = computeMetrics(null, effortIssues, start, finish, 0);
  const observedTotal = observedFocusFactor(allEffort.completedOriginalEffortMinutes, rawTotal);
  const completed = hasDates && isCompletedSprint(finish, nowMs);
  const totalsForCompletion = {
    ...allEffort,
    rawCapacityMinutes: rawTotal,
    plannedCapacityMinutes: plannedTotal,
    observedFocusFactor: observedTotal,
  };

  return {
    id: native.id,
    name: native.name,
    goal: native.goal,
    start: native.start ?? '',
    finish: native.finish ?? '',
    archived: native.archived,
    managed: entry !== null,
    sequence: entry?.sequence ?? 0,
    teams: teamViews,
    rawCapacityMinutes: rawTotal,
    plannedCapacityMinutes: plannedTotal,
    originalEffortMinutes: allEffort.originalEffortMinutes,
    currentEffortMinutes: allEffort.currentEffortMinutes,
    completedOriginalEffortMinutes: allEffort.completedOriginalEffortMinutes,
    observedFocusFactor: observedTotal,
    computedAt: nowMs,
    completion: completed ? buildCompletion(totalsForCompletion, start, finish, nowMs) : null,
    issuesMissingOriginalEffort: allEffort.issuesMissingOriginalEffort,
    unassignedEffort: allEffort.unassignedEffort ?? ZERO_EFFORT,
    unresolvedIssueCount: allEffort.unresolvedIssueCount,
  };
}
