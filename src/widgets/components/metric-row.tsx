import React from 'react';

export interface Metric {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

/** A compact definition-list row of metrics, styled to match YouTrack panels. */
export function MetricList({ metrics }: { metrics: Metric[] }): React.JSX.Element {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 'calc(var(--ring-unit) * 2)',
        margin: 0,
      }}
    >
      {metrics.map((m) => (
        <div key={m.label}>
          <dt
            style={{
              font: 'var(--ring-font-smaller)',
              color: 'var(--ring-secondary-color)',
            }}
            title={m.hint}
          >
            {m.label}
          </dt>
          <dd style={{ margin: 0, font: 'var(--ring-font-larger)', fontWeight: 'bold' }}>
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
