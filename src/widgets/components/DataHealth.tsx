import React from 'react';
import type { SprintView } from '../../shared/api';
import type { DataIntegrityStatus } from '../../shared/types';
import { formatTimestamp } from './format';

export interface DataHealthProps {
  sprint: SprintView;
}

interface StatusStyle {
  label: string;
  color: string;
  background: string;
}

const STATUS_STYLES: Record<DataIntegrityStatus, StatusStyle> = {
  'up-to-date': {
    label: 'Up to date',
    color: 'var(--ring-success-color, #1a936f)',
    background: 'var(--ring-success-background-color, #e5f5ee)',
  },
  incremental: {
    label: 'Incremental',
    color: 'var(--ring-secondary-color)',
    background: 'var(--ring-selected-background-color, #eef1f5)',
  },
  'needs-recalculation': {
    label: 'Needs recalculation',
    color: 'var(--ring-warning-color, #b38600)',
    background: 'var(--ring-warning-background-color, #fff6e0)',
  },
  recalculating: {
    label: 'Recalculating…',
    color: 'var(--ring-secondary-color)',
    background: 'var(--ring-selected-background-color, #eef1f5)',
  },
  error: {
    label: 'Error',
    color: 'var(--ring-error-color)',
    background: 'var(--ring-error-background-color, #ffe9e9)',
  },
};

/** §6.6 data health: a status pill plus the workflow/recalculation timestamps. */
export function DataHealth({ sprint }: DataHealthProps): React.JSX.Element {
  const style = STATUS_STYLES[sprint.dataIntegrityStatus];
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
          color: style.color,
          background: style.background,
        }}
      >
        {style.label}
        {sprint.metricsDirty ? ' • pending' : ''}
      </span>
      <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
        Last workflow update: {formatTimestamp(sprint.lastWorkflowUpdateAt)}
      </span>
      <span style={{ font: 'var(--ring-font-smaller)', color: 'var(--ring-secondary-color)' }}>
        Last recalculated: {formatTimestamp(sprint.lastRecalculatedAt)}
      </span>
    </section>
  );
}
