import React from 'react';
import type { SprintView, TeamSprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface EffortSummaryProps {
  /** The team the summary is scoped to (the selected team). */
  team: TeamSprintView;
  /** The whole Sprint, for unassigned work, the warning list and all-teams totals. */
  sprint: SprintView;
  /** True when the project has several teams (adds the totals line). */
  multiTeam: boolean;
  hoursPerDay: number;
}

/**
 * §6.5 effort summary for ONE team: Original, Current, Completed Original, Observed
 * Focus Factor over the team's attributed issues. Unassigned work belongs to no team
 * and is reported Sprint-wide, as is the "issues missing Original Effort" warning.
 */
export function EffortSummary({
  team,
  sprint,
  multiTeam,
  hoursPerDay,
}: EffortSummaryProps): React.JSX.Element {
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
      label: multiTeam ? 'Unassigned (sprint)' : 'Unassigned',
      value: formatDays(sprint.unassignedEffort.currentEffortMinutes, hoursPerDay),
      hint: 'Current effort on tasks with no assignee — spread it across the team or leave it owned',
    },
  ];

  const missing = sprint.issuesMissingOriginalEffort;

  return (
    <section aria-label="Effort summary" data-test="scp-effort-summary">
      <MetricList metrics={metrics} />
      {multiTeam ? (
        <p
          style={{
            marginTop: 'calc(var(--ring-unit))',
            marginBottom: 0,
            font: 'var(--ring-font-smaller)',
            color: 'var(--ring-secondary-color)',
          }}
        >
          All teams: {formatDays(sprint.originalEffortMinutes, hoursPerDay)} original ·{' '}
          {formatDays(sprint.currentEffortMinutes, hoursPerDay)} current ·{' '}
          {formatDays(sprint.completedOriginalEffortMinutes, hoursPerDay)} completed
        </p>
      ) : null}
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
