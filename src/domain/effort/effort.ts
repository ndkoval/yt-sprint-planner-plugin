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
}

/** Result of aggregating a Sprint's issues. */
export interface EffortAggregate {
  originalEffortMinutes: number;
  currentEffortMinutes: number;
  completedOriginalEffortMinutes: number;
  /** Ids of issues missing an Original Effort value (for the UI warning list). */
  issuesMissingOriginalEffort: string[];
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

  for (const issue of issues) {
    assertNonNegative(issue);

    // Original Effort: sum for ALL issues currently in the Sprint.
    if (issue.originalEffortMinutes === null) {
      missing.push(issue.id);
    } else {
      original += issue.originalEffortMinutes;
    }

    // Current Effort: only UNRESOLVED issues; resolved always contribute 0.
    if (!issue.resolved && issue.currentEffortMinutes !== null) {
      current += issue.currentEffortMinutes;
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
  };
}
