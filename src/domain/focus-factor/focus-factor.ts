/**
 * Focus Factor calibration. See §11.
 *
 * The Focus Factor is a learned multiplier (0–1) applied to Raw Capacity to produce
 * Planned Capacity. A brand-new team's first Sprint starts at {@link DEFAULT_FOCUS_FACTOR};
 * each subsequent Sprint nudges toward the previous Sprint's Observed Focus Factor by a
 * fraction (the learning rate). A manager can override the value on any Sprint.
 *
 * The algorithm, in one line:
 *   nextFactor = clamp01( previousFactor + learningRate × (observed − previousFactor) )
 */
import type { FocusFactorSettings, FocusFactorSource } from '../../shared/types.js';

/**
 * Focus Factor a fresh Sprint starts from when there is no completed Sprint to learn from
 * (no min/max bounds are configured — a manager simply edits the value if needed).
 */
export const DEFAULT_FOCUS_FACTOR = 0.75;

/** Clamp x into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  if (lo > hi) throw new RangeError(`clamp bounds inverted: [${lo}, ${hi}]`);
  return Math.min(hi, Math.max(lo, x));
}

/** Result of a Focus Factor computation, with its provenance. */
export interface FocusFactorResult {
  value: number;
  source: FocusFactorSource;
}

/**
 * Observed Focus Factor for a completed Sprint:
 *   Completed Original Effort / Raw Capacity
 * Returns null when Raw Capacity is 0 (spec §11.5).
 */
export function observedFocusFactor(
  completedOriginalEffortMinutes: number,
  rawCapacityMinutes: number,
): number | null {
  if (rawCapacityMinutes <= 0) return null;
  return completedOriginalEffortMinutes / rawCapacityMinutes;
}

/** A Sprint with no completed predecessor starts at the fixed default factor. */
export function bootstrapFocusFactor(): FocusFactorResult {
  return { value: DEFAULT_FOCUS_FACTOR, source: 'bootstrap' };
}

/**
 * Inputs describing the previous completed Sprint, used to calibrate the next factor.
 * `observed` is null when it could not be computed (e.g. zero Raw Capacity).
 */
export interface CalibrationInput {
  /** Previous Sprint's Focus Factor (P). */
  previousFactor: number;
  /** Previous Sprint's Observed Focus Factor (O), or null if unavailable. */
  observed: number | null;
  /**
   * True when the previous Sprint cannot be used for calibration and its factor must
   * simply be carried forward — e.g. Raw Capacity is 0, Original Effort is 0, the
   * Sprint is excluded, metrics are corrupt, or reconciliation is incomplete (§11.4).
   */
  carryForward: boolean;
}

/**
 * Compute the next Focus Factor from the previous Sprint (§11.3).
 *
 * When `carryForward` is set (or `observed` is null), the previous factor is carried
 * forward unchanged with source `carried-forward`. Otherwise it moves a `learningRate`
 * fraction of the way from the previous factor toward the observed factor, clamped to the
 * natural [0, 1] range of a factor:
 *
 *   newFactor = clamp01( P + α × (O − P) )
 */
export function nextFocusFactor(
  input: CalibrationInput,
  settings: FocusFactorSettings,
): FocusFactorResult {
  if (input.carryForward || input.observed === null) {
    return { value: clamp(input.previousFactor, 0, 1), source: 'carried-forward' };
  }

  const observation = clamp(input.observed, 0, 1);
  const adjustment = settings.learningRate * (observation - input.previousFactor);
  const value = clamp(input.previousFactor + adjustment, 0, 1);
  return { value, source: 'calculated' };
}
