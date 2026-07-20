/**
 * Focus Factor selection and mutation (§11). Chooses the calibration source Sprint,
 * computes the next factor, and applies manager overrides / calibration toggles.
 */
import {
  bootstrapFocusFactor,
  nextFocusFactor,
  type FocusFactorResult,
} from '../../domain/index.js';
import type { FocusFactorOverride, FocusFactorSettings } from '../../shared/types.js';
import type { Clock } from '../clock.js';
import { AppError } from '../errors.js';
import type { SprintRecord, SprintRepository } from '../repositories/sprint-repository.js';
import { isCompleted } from './reconciliation-service.js';

function settingsFrom(config: FocusFactorSettings): FocusFactorSettings {
  return { learningRate: config.learningRate };
}

/**
 * Pick the Sprint used to calibrate the next factor: the latest chronologically
 * completed managed Sprint that is eligible (§11.2). Returns null if none.
 */
export function selectCalibrationSource(
  managed: readonly SprintRecord[],
  nowMs: number,
): SprintRecord | null {
  const eligible = managed
    .filter((r) => r.native.finish && isCompleted(r.native.finish, nowMs))
    .filter((r) => !r.excludedFromCalibration)
    .filter((r) => r.rawCapacityMinutes > 0)
    .filter((r) => r.observedFocusFactor !== null)
    .filter((r) => r.dataIntegrityStatus === 'up-to-date');
  if (eligible.length === 0) return null;
  // Latest by finish date.
  return eligible.reduce((latest, r) =>
    (r.native.finish ?? '') > (latest.native.finish ?? '') ? r : latest,
  );
}

/**
 * Compute the next Sprint's Focus Factor from the managed Sprint history (§11.1–11.4).
 * Uses bootstrap when there is no eligible previous Sprint.
 */
export function computeNextFocusFactor(
  managed: readonly SprintRecord[],
  settings: FocusFactorSettings,
  nowMs: number,
): FocusFactorResult {
  const source = selectCalibrationSource(managed, nowMs);
  if (!source) {
    return bootstrapFocusFactor();
  }
  // Skip conditions (§11.4): carry forward when Original Effort is 0 (can't observe).
  const carryForward =
    source.originalEffortMinutes === 0 ||
    source.observedFocusFactor === null ||
    source.rawCapacityMinutes === 0;
  return nextFocusFactor(
    {
      previousFactor: source.focusFactor,
      observed: source.observedFocusFactor,
      carryForward,
    },
    settingsFrom(settings),
  );
}

export class FocusFactorService {
  constructor(
    private readonly repo: SprintRepository,
    private readonly clock: Clock,
  ) {}

  /** Manager override (§11.6): records reason/old/new/user/timestamp; no locks. */
  async override(
    record: SprintRecord,
    reason: string,
    newValue: number,
    userId: string,
  ): Promise<FocusFactorOverride> {
    if (newValue < 0 || newValue > 1) {
      throw new AppError('VALIDATION_FAILED', 'Focus Factor must be between 0 and 1.');
    }
    const override: FocusFactorOverride = {
      reason,
      oldValue: record.focusFactor,
      newValue,
      userId,
      timestamp: this.clock.now(),
    };
    await this.repo.saveFocusFactor(record.native.id, newValue, 'manual', override);
    return override;
  }

  async setCalibration(record: SprintRecord, excluded: boolean, reason: string): Promise<void> {
    await this.repo.saveCalibration(record.native.id, excluded, excluded ? reason : null);
  }
}
