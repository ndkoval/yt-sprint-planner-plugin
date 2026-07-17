/**
 * Effort aggregation over the issues currently in a native Sprint. See §10.
 *
 * All effort is in minutes. Rules:
 *   - Missing Original Effort   → contributes 0 (caller surfaces a warning).
 *   - Missing Current Effort    → contributes 0.
 *   - Resolved issue            → Current Effort contribution is always 0.
 *   - Completed Original Effort → Original Effort of issues resolved within Sprint dates.
 *   - Negative period           → validation error (rejected before aggregation).
 */

/** A single issue as seen by the effort calculation layer. */
export interface EffortIssue {
  id: string;
  /** Original Effort in minutes, or null if the field is unset. */
  originalEffortMinutes: number | null;
  /** Current Effort in minutes, or null if the field is unset. */
  currentEffortMinutes: number | null;
  resolved: boolean;
  /** UTC ms the issue was resolved, or null if unresolved. */
  resolvedAt: number | null;
  /**
   * Stable user id of the issue's assignee, or null when unassigned. Assigning tasks to
   * owners lets the team see per-person load while still leaving some work unassigned so
   * project direction ownership is preserved.
   */
  assigneeId?: string | null | undefined;
}

/** Effort attributed to one assignee (or the unassigned bucket). */
export interface AssigneeEffort {
  originalEffortMinutes: number;
  currentEffortMinutes: number;
}

/** Result of aggregating a Sprint's issues. */
export interface EffortAggregate {
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  /** Ids of issues missing an Original Effort value (for the UI warning list). */
  issuesMissingOriginalEffort: string[];
  /** Per-assignee effort (keyed by user id) for planning per-person load. */
  byAssignee: Record<string, AssigneeEffort>;
  /** Effort for issues left unassigned (preserving project-direction ownership). */
  unassigned: AssigneeEffort;
}

/** Throw if any period value is negative (spec §10.4: negative period → validation error). */
function assertNonNegative(issue: EffortIssue): void {
  if (issue.originalEffortMinutes !== null && issue.originalEffortMinutes < 0) {
    throw new RangeError(`issue ${issue.id} has negative Original Effort`);
  }
  if (issue.currentEffortMinutes !== null && issue.currentEffortMinutes < 0) {
    throw new RangeError(`issue ${issue.id} has negative Current Effort`);
  }
}

/**
 * Aggregate effort for the issues currently in a Sprint.
 *
 * @param issues     Issues currently belonging to the native Sprint.
 * @param sprintStartMs UTC ms of Sprint start (inclusive).
 * @param sprintFinishMs UTC ms of Sprint finish (inclusive).
 */
export function aggregateEffort(
  issues: readonly EffortIssue[],
  sprintStartMs: number,
  sprintFinishMs: number,
): EffortAggregate {
  let original = 0;
  let current = 0;
  let completed = 0;
  const missing: string[] = [];
  const byAssignee: Record<string, AssigneeEffort> = {};
  const unassigned: AssigneeEffort = { originalEffortMinutes: 0, currentEffortMinutes: 0 };

  const bucketFor = (assigneeId: string | null | undefined): AssigneeEffort => {
    if (assigneeId === null || assigneeId === undefined) return unassigned;
    return (byAssignee[assigneeId] ??= { originalEffortMinutes: 0, currentEffortMinutes: 0 });
  };

  for (const issue of issues) {
    assertNonNegative(issue);
    const bucket = bucketFor(issue.assigneeId);

    // Original Effort: sum for ALL issues currently in the Sprint.
    if (issue.originalEffortMinutes === null) {
      missing.push(issue.id);
    } else {
      original += issue.originalEffortMinutes;
      bucket.originalEffortMinutes += issue.originalEffortMinutes;
    }

    // Current Effort: only UNRESOLVED issues; resolved always contribute 0.
    if (!issue.resolved && issue.currentEffortMinutes !== null) {
      current += issue.currentEffortMinutes;
      bucket.currentEffortMinutes += issue.currentEffortMinutes;
    }

    // Completed Original Effort: Original Effort of issues resolved within Sprint dates.
    if (
      issue.resolved &&
      issue.resolvedAt !== null &&
      issue.resolvedAt >= sprintStartMs &&
      issue.resolvedAt <= sprintFinishMs &&
      issue.originalEffortMinutes !== null
    ) {
      completed += issue.originalEffortMinutes;
    }
  }

  return {
    originalEffortMinutes: original,
    currentEffortMinutes: current,
    completedOriginalEffortMinutes: completed,
    issuesMissingOriginalEffort: missing,
    byAssignee,
    unassigned,
  };
}
