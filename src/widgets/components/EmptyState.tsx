import React from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/** Neutral placeholder shown when there is nothing to display yet. */
export function EmptyState({ title, description, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'calc(var(--ring-unit) * 4) calc(var(--ring-unit) * 2)',
        color: 'var(--ring-secondary-color)',
      }}
    >
      <div style={{ font: 'var(--ring-font-smaller-lower)', fontWeight: 'bold' }}>{title}</div>
      {description !== undefined ? (
        <p style={{ marginTop: 'var(--ring-unit)' }}>{description}</p>
      ) : null}
      {action !== undefined ? (
        <div style={{ marginTop: 'calc(var(--ring-unit) * 2)' }}>{action}</div>
      ) : null}
    </div>
  );
}
