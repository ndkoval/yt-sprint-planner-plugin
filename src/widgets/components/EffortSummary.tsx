import React from 'react';
import type { SprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface EffortSummaryProps {
  sprint: SprintView;
  hoursPerDay: number;
}

/**
 * §6.5 effort summary: Original, Current, Completed Original, Observed Focus Factor.
 * Also surfaces the "issues missing Original Effort" warning list.
 */
export function EffortSummary({ sprint, hoursPerDay }: EffortSummaryProps): React.JSX.Element {
  const metrics: Metric[] = [
    { label: 'Original effort', value: formatDays(sprint.originalEffortMinutes, hoursPerDay) },
    { label: 'Current effort', value: formatDays(sprint.currentEffortMinutes, hoursPerDay) },
    {
      label: 'Completed original',
      value: formatDays(sprint.completedOriginalEffortMinutes, hoursPerDay),
    },
    {
      label: 'Observed focus factor',
      value: formatFocusFactor(sprint.observedFocusFactor),
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
    <section aria-label="Effort summary">
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
