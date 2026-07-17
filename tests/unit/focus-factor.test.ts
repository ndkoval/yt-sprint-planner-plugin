import { describe, it, expect } from 'vitest';
import {
  clamp,
  observedFocusFactor,
  bootstrapFocusFactor,
  nextFocusFactor,
  type CalibrationInput,
} from '../../src/domain/focus-factor/focus-factor.js';
import type { FocusFactorSettings } from '../../src/shared/types.js';

const settings: FocusFactorSettings = {
  bootstrapFocusFactor: 0.7,
  learningRate: 0.2,
  maxFactorStep: 0.03,
  minFocusFactor: 0.1,
  maxFocusFactor: 1,
};

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
  it('returns the configured bootstrap value with source bootstrap', () => {
    expect(bootstrapFocusFactor(settings)).toEqual({ value: 0.7, source: 'bootstrap' });
  });
});

describe('nextFocusFactor', () => {
  it('applies the normal adjustment (worked example: P=0.75, O=0.65, a=0.20, M=0.03 -> 0.73)', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.75, observed: 0.65 }), settings);
    expect(r.source).toBe('calculated');
    expect(r.value).toBeCloseTo(0.73, 10);
  });

  it('clamps a large positive step to +maxFactorStep', () => {
    // O well above P -> raw adjustment far exceeds +M; result is P + M.
    const r = nextFocusFactor(input({ previousFactor: 0.5, observed: 1 }), settings);
    expect(r.source).toBe('calculated');
    expect(r.value).toBeCloseTo(0.53, 10);
  });

  it('clamps a large negative step to -maxFactorStep', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.9, observed: 0.1 }), settings);
    expect(r.value).toBeCloseTo(0.87, 10);
  });

  it('clamps the result to the configured minimum', () => {
    const s: FocusFactorSettings = { ...settings, minFocusFactor: 0.6, maxFactorStep: 0.03 };
    // P below min; a small upward step still lands below min -> clamp up to 0.6.
    const r = nextFocusFactor(input({ previousFactor: 0.5, observed: 0.1 }), s);
    expect(r.value).toBe(0.6);
  });

  it('clamps the result to the configured maximum', () => {
    const s: FocusFactorSettings = {
      ...settings,
      maxFocusFactor: 0.8,
      maxFactorStep: 0.05,
      learningRate: 10,
    };
    // Pre-clamp value 0.79 + 0.05 = 0.84 overshoots max -> clamp down to 0.8.
    const r = nextFocusFactor(input({ previousFactor: 0.79, observed: 0.8 }), s);
    expect(r.value).toBe(0.8);
  });

  it('bounds the observation before computing the step', () => {
    // observed above max is first clamped to max (1) before the learning step.
    const s: FocusFactorSettings = { ...settings, maxFocusFactor: 0.8, maxFactorStep: 1, learningRate: 1 };
    const r = nextFocusFactor(input({ previousFactor: 0.7, observed: 5 }), s);
    // boundedObservation = 0.8; adjustment = 1*(0.8-0.7)=0.1; value = clamp(0.8, .1, .8) = 0.8
    expect(r.value).toBe(0.8);
  });

  it('carries the previous factor forward when carryForward is set', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.72, carryForward: true }), settings);
    expect(r).toEqual({ value: 0.72, source: 'carried-forward' });
  });

  it('carries forward when observed is null', () => {
    const r = nextFocusFactor(input({ previousFactor: 0.72, observed: null }), settings);
    expect(r).toEqual({ value: 0.72, source: 'carried-forward' });
  });

  it('respects bounds even when carrying forward', () => {
    const r = nextFocusFactor(input({ previousFactor: 5, carryForward: true }), settings);
    expect(r).toEqual({ value: 1, source: 'carried-forward' });
  });
});
