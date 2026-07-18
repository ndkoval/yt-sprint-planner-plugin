import React from 'react';
import type { SprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { committedFitMinutes, remainingCapacityMinutes } from '../../domain/capacity/capacity';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface CapacitySummaryProps {
  sprint: SprintView;
  hoursPerDay: number;
}

/**
 * §6.4 capacity summary: Raw / Focus Factor / Planned / Remaining capacity, plus a
 * "what fits" banner comparing committed Original Effort against planned capacity.
 * Minute values render as days.
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
      label: 'Remaining capacity',
      value: formatDays(
        remainingCapacityMinutes(sprint.plannedCapacityMinutes, sprint.currentEffortMinutes),
        hoursPerDay,
      ),
      hint: 'Planned capacity − current effort',
    },
  ];

  // "What fits": committed Original Effort vs planned capacity (the Jira capacity-vs-
  // commitment check). Positive headroom = it fits; negative = over-committed.
  const headroom = committedFitMinutes(sprint.plannedCapacityMinutes, sprint.originalEffortMinutes);
  const over = headroom < 0;
  const fitStyle: React.CSSProperties = {
    marginTop: 'calc(var(--ring-unit) * 2)',
    padding: 'calc(var(--ring-unit) * 1) calc(var(--ring-unit) * 1.5)',
    borderRadius: 'var(--ring-border-radius, 6px)',
    font: 'var(--ring-font)',
    fontWeight: 'bold',
    color: over ? 'var(--ring-error-color, #c0341d)' : 'var(--ring-success-color, #1a936f)',
    background: over ? 'rgba(192,52,29,0.08)' : 'rgba(26,147,111,0.08)',
  };

  return (
    <section aria-label="Capacity summary">
      <MetricList metrics={metrics} />
      <div role="status" aria-live="polite" style={fitStyle}>
        Committed {formatDays(sprint.originalEffortMinutes, hoursPerDay)} vs planned{' '}
        {formatDays(sprint.plannedCapacityMinutes, hoursPerDay)} —{' '}
        {over
          ? `over by ${formatDays(-headroom, hoursPerDay)}`
          : `${formatDays(headroom, hoursPerDay)} headroom (it fits)`}
      </div>
    </section>
  );
}
