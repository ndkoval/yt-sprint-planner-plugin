import { describe, it, expect } from 'vitest';
import * as domain from '../../src/domain/index.js';

describe('domain barrel', () => {
  it('re-exports the public calculation API from every area', () => {
    expect(typeof domain.countWorkingDays).toBe('function');
    expect(typeof domain.defaultCapacityMinutes).toBe('function');
    expect(typeof domain.aggregateEffort).toBe('function');
    expect(typeof domain.nextFocusFactor).toBe('function');
    expect(typeof domain.renderSprintName).toBe('function');
    expect(typeof domain.canCreateSprint).toBe('function');
    expect(typeof domain.computeMetrics).toBe('function');
    expect(typeof domain.seedCapacityDocument).toBe('function');
    expect(typeof domain.migrate).toBe('function');
  });
});
