/**
 * Shared widget bootstrap: register with the YouTrack host FIRST (eagerly), then
 * render the planner with a ready ApiClient. Registration failure renders an explicit
 * message instead of surfacing as an opaque host-side load error.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@jetbrains/ring-ui-built/components/style.css';
import { ApiClient } from './api-client';
import { initHost } from './host';
import { SprintCapacityTab } from './project-tab/SprintCapacityTab';

export function bootstrapPlannerWidget(): void {
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('Root container #root not found in the widget host page.');
  }
  const root = createRoot(container);
  initHost().then(
    (host) => {
      root.render(
        <React.StrictMode>
          <SprintCapacityTab client={new ApiClient(host)} />
        </React.StrictMode>,
      );
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      root.render(
        <div role="alert" style={{ padding: 16, font: 'var(--ring-font)' }}>
          <strong>Sprint Capacity Planner could not start.</strong>
          <div style={{ color: 'var(--ring-secondary-color)', marginTop: 8 }}>{message}</div>
        </div>,
      );
    },
  );
}
