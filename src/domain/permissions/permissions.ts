/**
 * Authorization decisions. See §16. These are PURE decision functions; the backend
 * enforces them server-side on every mutation. Frontend visibility is never
 * authorization.
 *
 * A user is a "manager" iff they belong to the configured Capacity Managers group.
 * Board-level actions (create / edit native Sprint) additionally require the caller's
 * real YouTrack Board permission, which is checked at the REST boundary — not here.
 */
import type { UserId } from '../../shared/types.js';

export interface Principal {
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

/** Confirm/unconfirm follows the same rule as editing a row. */
export const canConfirmAvailability = canEditCapacityRow;

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

/**
 * Creating / editing the native Sprint requires manager role AND a real Board
 * permission. The Board permission is resolved from YouTrack at the REST boundary
 * and passed in as `hasBoardPermission`.
 */
export function canCreateSprint(principal: Principal, hasBoardPermission: boolean): boolean {
  return principal.isManager && hasBoardPermission;
}
export const canEditSprintDetails = canCreateSprint;
