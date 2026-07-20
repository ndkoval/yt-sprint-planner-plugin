import React from 'react';
import { createRoot } from 'react-dom/client';
import '@jetbrains/ring-ui-built/components/style.css';
import { SprintCapacityTab } from '../project-tab/SprintCapacityTab';

/**
 * DASHBOARD_WIDGET entry point: a Sprint Capacity Planner widget for dashboards and the
 * project overview page — an always-reachable way into the planner. The ApiClient resolves
 * the project from context (or ?projectId); without one the planner shows a clear message.
 */
const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root not found in the widget host page.');
}
createRoot(container).render(
  <React.StrictMode>
    <SprintCapacityTab />
  </React.StrictMode>,
);
