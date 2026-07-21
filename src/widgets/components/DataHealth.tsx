import React from 'react';
import type { SprintView } from '../../shared/api';
import { formatTimestamp } from './format';

export interface DataHealthProps {
  sprint: SprintView;
}

/**
 * §6.6 data health. Metrics are computed live from the current issue set on every
 * read, so the pill reports freshness (when this view was computed) rather than a
 * cache state — there is no cache to go stale.
 */
export function DataHealth({ sprint }: DataHealthProps): React.JSX.Element {
  return (
    <section
      aria-label="Data health"
      style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--ring-unit) * 2)' }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '2px calc(var(--ring-unit) * 1)',
          borderRadius: 'var(--ring-border-radius)',
          font: 'var(--ring-font-smaller)',
          fontWeight: 'bold',
          color: 'var(--ring-success-color, #1a936f)',
          background: 'var(--ring-success-background-color, #e5f5ee)',
        }}
      >
        Live
      </span>
      <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
        Computed: {formatTimestamp(sprint.computedAt)}
      </span>
      {sprint.issuesMissingOriginalEffort.length > 0 ? (
        <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-warning-color, #b38600)' }}>
          {sprint.issuesMissingOriginalEffort.length} issue
          {sprint.issuesMissingOriginalEffort.length === 1 ? '' : 's'} without Original Effort
        </span>
      ) : null}
    </section>
  );
}
