/** Injectable clock so services stay deterministic under test. */
export interface Clock {
  /** Current time as UTC epoch ms. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A fixed clock for tests. */
export function fixedClock(ms: number): Clock {
  return { now: () => ms };
}
