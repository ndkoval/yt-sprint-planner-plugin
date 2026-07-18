import React from 'react';
import type { SprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { remainingCapacityMinutes } from '../../domain/capacity/capacity';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface CapacitySummaryProps {
  sprint: SprintView;
  hoursPerDay: number;
}

/**
 * §6.4 capacity summary: Participants Confirmed X/Y, Raw, Confirmed, Focus Factor,
 * Planned. Minute values render as days.
 */
export function CapacitySummary({ sprint, hoursPerDay }: CapacitySummaryProps): React.JSX.Element {
  const metrics: Metric[] = [
    { label: 'Raw capacity', value: formatDays(sprint.rawCapacityMinutes, hoursPerDay) },
    {
      label: 'Focus factor',
      value: formatFocusFactor(sprint.focusFactor),
      hint: `Source: ${sprint.focusFactorSource}`,
    },
    {
      label: 'Planned capacity',
      value: formatDays(sprint.plannedCapacityMinutes, hoursPerDay),
      hint: 'Raw capacity × focus factor',
    },
    {
      // Planned capacity minus the current (remaining) effort on unresolved issues.
      // Updates automatically as issues are added/estimated/resolved (via workflows +
      // reconciliation). Negative means the Sprint is over-committed.
      label: 'Remaining capacity',
      value: formatDays(
        remainingCapacityMinutes(sprint.plannedCapacityMinutes, sprint.currentEffortMinutes),
        hoursPerDay,
      ),
      hint: 'Planned capacity − current effort',
    },
  ];

  return (
    <section aria-label="Capacity summary">
      <MetricList metrics={metrics} />
    </section>
  );
}
