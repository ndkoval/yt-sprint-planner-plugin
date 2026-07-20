import { describe, it, expect } from 'vitest';
import {
  clamp,
  observedFocusFactor,
  bootstrapFocusFactor,
  nextFocusFactor,
  DEFAULT_FOCUS_FACTOR,
  type CalibrationInput,
} from '../../src/domain/focus-factor/focus-factor.js';
import type { FocusFactorSettings } from '../../src/shared/types.js';

const settings: FocusFactorSettings = { learningRate: 0.2 };

function input(overrides: Partial<CalibrationInput> = {}): CalibrationInput {
  return { previousFactor: 0.75, observed: 0.65, carryForward: false, ...overrides };
}

describe('clamp', () => {
  it('returns the value when within bounds', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('clamps to the lower bound', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  it('clamps to the upper bound', () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });

  it('throws when bounds are inverted', () => {
    expect(() => clamp(0.5, 1, 0)).toThrow(RangeError);
  });
});

describe('observedFocusFactor', () => {
  it('is completedOriginalEffort / rawCapacity', () => {
    expect(observedFocusFactor(3600, 4800)).toBe(0.75);
  });

  it('returns null when raw capacity is 0', () => {
    expect(observedFocusFactor(3600, 0)).toBeNull();
  });

  it('returns null when raw capacity is negative', () => {
    expect(observedFocusFactor(3600, -1)).toBeNull();
  });
});

describe('bootstrapFocusFactor', () => {
  it('returns the fixed default value with source bootstrap', () => {
    expect(bootstrapFocusFactor()).toEqual({ value: DEFAULT_FOCUS_FACTOR, source: 'bootstrap' });
    expect(DEFAULT_FOCUS_FACTOR).toBe(0.75);
  });
});

describe('nextFocusFactor', () => {
  it('moves learningRate of the way toward the observation (P=0.75, O=0.65, a=0.20 -> 0.73)', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.75, observed: 0.65 }), settings);
    expect(r.source).toBe('calculated');
    // 0.75 + 0.2*(0.65-0.75) = 0.73
    expect(r.value).toBeCloseTo(0.73, 10);
  });

  it('moves upward toward a higher observation', () => {
    // 0.5 + 0.2*(1-0.5) = 0.6
    const r = nextFocusFactor(input({ previousFactor: 0.5, observed: 1 }), settings);
    expect(r.source).toBe('calculated');
    expect(r.value).toBeCloseTo(0.6, 10);
  });

  it('moves downward toward a lower observation', () => {
    // 0.9 + 0.2*(0.1-0.9) = 0.74
    const r = nextFocusFactor(input({ previousFactor: 0.9, observed: 0.1 }), settings);
    expect(r.value).toBeCloseTo(0.74, 10);
  });

  it('clamps the observation into [0,1] before stepping', () => {
    // observed 5 is clamped to 1; 0.7 + 1*(1-0.7) = 1.0 (learningRate 1)
    const r = nextFocusFactor(input({ previousFactor: 0.7, observed: 5 }), { learningRate: 1 });
    expect(r.value).toBe(1);
  });

  it('clamps the result into [0,1]', () => {
    // A huge learning rate cannot push the factor above 1.
    const r = nextFocusFactor(input({ previousFactor: 0.9, observed: 1 }), { learningRate: 10 });
    expect(r.value).toBe(1);
  });

  it('carries the previous factor forward when carryForward is set', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.72, carryForward: true }), settings);
    expect(r).toEqual({ value: 0.72, source: 'carried-forward' });
  });

  it('carries forward when observed is null', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.72, observed: null }), settings);
    expect(r).toEqual({ value: 0.72, source: 'carried-forward' });
  });

  it('clamps a carried-forward factor into [0,1]', () => {
    const r = nextFocusFactor(input({ previousFactor: 5, carryForward: true }), settings);
    expect(r).toEqual({ value: 1, source: 'carried-forward' });
  });
});
