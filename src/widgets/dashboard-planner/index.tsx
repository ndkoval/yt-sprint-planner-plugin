/**
 * DASHBOARD_WIDGET entry point: a Sprint Capacity Planner widget for dashboards and the
 * project overview page — an always-reachable way into the planner. The ApiClient resolves
 * the project from context (or ?projectId); without one the planner shows a clear message.
 */
import { bootstrapPlannerWidget } from '../bootstrap';

bootstrapPlannerWidget();
