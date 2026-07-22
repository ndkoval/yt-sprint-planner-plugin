import React from 'react';
import type { SprintView, TeamSprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface EffortSummaryProps {
  /** The team the summary is scoped to (since v4 the team IS the Sprint's context). */
  team: TeamSprintView;
  /** The Sprint view, for unassigned work and the missing-effort warning list. */
  sprint: SprintView;
  hoursPerDay: number;
}

/**
 * §6.5 effort summary for the team: Original, Current, Completed Original, Observed
 * Focus Factor over the team's attributed issues. Unassigned work (no assignee yet)
 * and the "issues missing Original Effort" warning cover the whole Sprint on the
 * team's board.
 */
export function EffortSummary({ team, sprint, hoursPerDay }: EffortSummaryProps): React.JSX.Element {
  const metrics: Metric[] = [
    { label: 'Original effort', value: formatDays(team.originalEffortMinutes, hoursPerDay) },
    { label: 'Current effort', value: formatDays(team.currentEffortMinutes, hoursPerDay) },
    {
      label: 'Completed original',
      value: formatDays(team.completedOriginalEffortMinutes, hoursPerDay),
    },
    {
      label: 'Observed focus factor',
      value: formatFocusFactor(team.observedFocusFactor),
      hint: 'Completed original effort ÷ raw capacity',
    },
    {
      label: 'Unassigned',
      value: formatDays(sprint.unassignedEffort.currentEffortMinutes, hoursPerDay),
      hint: 'Current effort on tasks with no assignee — spread it across the team or leave it owned',
    },
  ];

  const missing = sprint.issuesMissingOriginalEffort;

  return (
    <section aria-label="Effort summary" data-test="scp-effort-summary">
      <MetricList metrics={metrics} />
      {missing.length > 0 ? (
        <p
          role="note"
          style={{
            marginTop: 'calc(var(--ring-unit) * 2)',
            color: 'var(--ring-warning-color, #b38600)',
            font: 'var(--ring-font-smaller)',
          }}
        >
          {missing.length} Sprint issue{missing.length === 1 ? '' : 's'} missing Original Effort.
        </p>
      ) : null}
    </section>
  );
}
