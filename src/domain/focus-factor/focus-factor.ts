/**
 * Focus Factor calibration. See §11.
 *
 * The Focus Factor is a learned multiplier applied to Raw Capacity to produce
 * Planned Capacity. The first Sprint uses a bootstrap value; each subsequent Sprint
 * nudges toward the previous Sprint's Observed Focus Factor, bounded by a learning
 * rate, a per-Sprint maximum step, and hard min/max clamps.
 */
import type { FocusFactorSettings, FocusFactorSource } from '../../shared/types.js';

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

/** The first Sprint always uses the bootstrap factor. */
export function bootstrapFocusFactor(settings: FocusFactorSettings): FocusFactorResult {
  return { value: settings.bootstrapFocusFactor, source: 'bootstrap' };
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
 * forward unchanged with source `carried-forward`. Otherwise:
 *
 *   boundedObservation = clamp(O, min, max)
 *   adjustment         = clamp(α × (boundedObservation − P), −M, +M)
 *   newFactor          = clamp(P + adjustment, min, max)
 */
export function nextFocusFactor(
  input: CalibrationInput,
  settings: FocusFactorSettings,
): FocusFactorResult {
  const { minFocusFactor: min, maxFocusFactor: max } = settings;

  if (input.carryForward || input.observed === null) {
    // Carry forward, but still respect the configured bounds.
    return { value: clamp(input.previousFactor, min, max), source: 'carried-forward' };
  }

  const boundedObservation = clamp(input.observed, min, max);
  const rawAdjustment = settings.learningRate * (boundedObservation - input.previousFactor);
  const adjustment = clamp(rawAdjustment, -settings.maxFactorStep, settings.maxFactorStep);
  const value = clamp(input.previousFactor + adjustment, min, max);
  return { value, source: 'calculated' };
}
