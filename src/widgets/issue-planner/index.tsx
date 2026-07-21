/**
 * ISSUE_OPTIONS_MENU_ITEM entry point: board cards are issues, so opening a card exposes
 * the issue options menu. This item opens the Sprint Capacity Planner scoped to the issue's
 * project (resolved from the issue context by the ApiClient) — the closest thing to an
 * "open the planner from the board" action YouTrack allows an app.
 */
import { bootstrapPlannerWidget } from '../bootstrap';

bootstrapPlannerWidget();
