/**
 * MAIN_MENU_ITEM entry point: "Sprint Capacity Planner" in the global sidebar — a
 * direct, project-independent way into the planner (handy for team members updating
 * their availability without hunting for the project-settings tab). There is no
 * project context here; the planner shows a picker over the caller's visible
 * projects (remembering the last choice) and binds late.
 */
import { bootstrapPlannerWidget } from '../bootstrap';

bootstrapPlannerWidget();
