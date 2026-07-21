/**
 * Authorization decisions. See §16. These are PURE decision functions; the backend
 * enforces them server-side on every app-state mutation. Frontend visibility is never
 * authorization.
 *
 * A user is a "manager" iff they belong to the configured Capacity Managers group.
 * Native Sprint mutations (create / edit) run through the current user's own REST
 * session, so YouTrack itself enforces the real board permission — not this layer.
 */
import type { UserId } from '../../shared/types.js';

export interface Principal {
  /** User login. */
  userId: UserId;
  isManager: boolean;
}

/** Every capacity mutation targets a specific row. */
export interface CapacityMutation {
  targetUserId: UserId;
}

/** A member may read Sprint data, capacity table and metrics. Everyone authenticated can. */
export function canReadSprint(_principal: Principal): boolean {
  return true;
}

/**
 * A member may edit their OWN capacity row (available, confirmed, note); a manager
 * may edit ANY row.
 */
export function canEditCapacityRow(principal: Principal, mutation: CapacityMutation): boolean {
  if (principal.isManager) return true;
  return principal.userId === mutation.targetUserId;
}

/** Manager-only actions. */
export function canEditSettings(principal: Principal): boolean {
  return principal.isManager;
}
export function canOverrideFocusFactor(principal: Principal): boolean {
  return principal.isManager;
}
export function canChangeCalibration(principal: Principal): boolean {
  return principal.isManager;
}
export function canRecalculate(principal: Principal): boolean {
  return principal.isManager;
}
export function canImportExport(principal: Principal): boolean {
  return principal.isManager;
}
export function canReadDiagnostics(principal: Principal): boolean {
  return principal.isManager;
}
/** Assigning Sprint issues to teammates is a manager planning action. */
export function canAssignIssues(principal: Principal): boolean {
  return principal.isManager;
}

/**
 * Creating / editing the native Sprint is a manager planning action in the app;
 * YouTrack additionally enforces the caller's real board permission because the
 * native mutation runs in the current user's own REST session.
 */
export function canCreateSprint(principal: Principal): boolean {
  return principal.isManager;
}
export const canEditSprintDetails = canCreateSprint;
