import React from 'react';
import { createRoot } from 'react-dom/client';
import '@jetbrains/ring-ui-built/components/style.css';
import { SprintCapacityTab } from '../project-tab/SprintCapacityTab';

/**
 * ISSUE_OPTIONS_MENU_ITEM entry point: board cards are issues, so opening a card exposes
 * the issue options menu. This item opens the Sprint Capacity Planner scoped to the issue's
 * project (resolved from the issue context by the ApiClient) — the closest thing to an
 * "open the planner from the board" action YouTrack allows an app.
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
