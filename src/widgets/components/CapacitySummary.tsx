import React from 'react';
import type { SprintView, TeamSprintView } from '../../shared/api';
import { formatDays } from '../../shared/units';
import { committedFitMinutes, remainingCapacityMinutes } from '../../domain/capacity/capacity';
import { formatFocusFactor } from './format';
import { MetricList, type Metric } from './metric-row';

export interface CapacitySummaryProps {
  /** The team the summary is scoped to (the selected team). */
  team: TeamSprintView;
  /** The whole Sprint, for the all-teams totals line. */
  sprint: SprintView;
  /** True when the project has several teams (adds the totals line + team label). */
  multiTeam: boolean;
  hoursPerDay: number;
}

/**
 * §6.4 capacity summary for ONE team: Raw / Focus Factor / Planned / Remaining
 * capacity, plus a "what fits" banner comparing the team's committed Original Effort
 * against its planned capacity. With several teams a compact all-teams totals line
 * keeps the Sprint-wide picture in view. Minute values render as days.
 */
export function CapacitySummary({
  team,
  sprint,
  multiTeam,
  hoursPerDay,
}: CapacitySummaryProps): React.JSX.Element {
  const metrics: Metric[] = [
    { label: 'Raw capacity', value: formatDays(team.rawCapacityMinutes, hoursPerDay) },
    {
      label: 'Focus factor',
      value: formatFocusFactor(team.focusFactor),
      hint: `Source: ${team.focusFactorSource}`,
    },
    {
      label: 'Planned capacity',
      value: formatDays(team.plannedCapacityMinutes, hoursPerDay),
      hint: 'Raw capacity × focus factor',
    },
    {
      label: 'Remaining capacity',
      value: formatDays(
        remainingCapacityMinutes(team.plannedCapacityMinutes, team.currentEffortMinutes),
        hoursPerDay,
      ),
      hint: 'Planned capacity − current effort',
    },
  ];

  // "What fits": the team's committed Original Effort vs its planned capacity (the
  // Jira capacity-vs-commitment check). Positive headroom = it fits; negative = over.
  const headroom = committedFitMinutes(team.plannedCapacityMinutes, team.originalEffortMinutes);
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
    <section aria-label="Capacity summary" data-test="scp-capacity-summary">
      <MetricList metrics={metrics} />
      <div role="status" aria-live="polite" style={fitStyle}>
        {multiTeam ? `${team.teamName}: ` : ''}Committed{' '}
        {formatDays(team.originalEffortMinutes, hoursPerDay)} vs planned{' '}
        {formatDays(team.plannedCapacityMinutes, hoursPerDay)} —{' '}
        {over
          ? `over by ${formatDays(-headroom, hoursPerDay)}`
          : `${formatDays(headroom, hoursPerDay)} headroom (it fits)`}
      </div>
      {multiTeam ? (
        <p
          data-test="scp-all-teams-totals"
          style={{
            marginTop: 'calc(var(--ring-unit))',
            marginBottom: 0,
            font: 'var(--ring-font-smaller)',
            color: 'var(--ring-secondary-color)',
          }}
        >
          All teams: {formatDays(sprint.rawCapacityMinutes, hoursPerDay)} raw ·{' '}
          {formatDays(sprint.plannedCapacityMinutes, hoursPerDay)} planned ·{' '}
          {formatDays(sprint.originalEffortMinutes, hoursPerDay)} committed
          {sprint.unassignedEffort.originalEffortMinutes > 0
            ? ` (${formatDays(sprint.unassignedEffort.originalEffortMinutes, hoursPerDay)} unassigned)`
            : ''}
        </p>
      ) : null}
    </section>
  );
}
