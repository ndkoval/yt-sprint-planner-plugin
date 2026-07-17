import { describe, it, expect } from 'vitest';
import {
  renderSprintName,
  nextSequence,
  isDuplicateName,
  type NameContext,
} from '../../src/domain/sprint/naming.js';

const ctx: NameContext = {
  year: 2026,
  sequence: 7,
  startDate: '2026-07-13',
  finishDate: '2026-07-26',
};

describe('renderSprintName', () => {
  it('substitutes all four placeholders', () => {
    expect(renderSprintName('{year}-S{sequence} ({startDate}..{finishDate})', ctx)).toBe(
      '2026-S7 (2026-07-13..2026-07-26)',
    );
  });

  it('renders the default template', () => {
    expect(renderSprintName('AppGlass {year}-S{sequence}', ctx)).toBe('AppGlass 2026-S7');
  });

  it('replaces repeated placeholders', () => {
    expect(renderSprintName('{sequence}-{sequence}', ctx)).toBe('7-7');
  });

  it('leaves unknown placeholders intact', () => {
    expect(renderSprintName('{year} {unknown}', ctx)).toBe('2026 {unknown}');
  });

  it('returns a template with no placeholders unchanged', () => {
    expect(renderSprintName('Static Name', ctx)).toBe('Static Name');
  });
});

describe('nextSequence', () => {
  it('returns 1 when there are no existing sprints', () => {
    expect(nextSequence([])).toBe(1);
  });

  it('returns max + 1 otherwise', () => {
    expect(nextSequence([1, 2, 5, 3])).toBe(6);
  });

  it('is monotonic regardless of ordering or gaps', () => {
    expect(nextSequence([10])).toBe(11);
  });
});

describe('isDuplicateName', () => {
  it('detects an exact collision', () => {
    expect(isDuplicateName('Sprint 1', ['Sprint 1', 'Sprint 2'])).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDuplicateName('sprint 1', ['SPRINT 1'])).toBe(true);
  });

  it('is trimmed', () => {
    expect(isDuplicateName('  Sprint 1  ', ['Sprint 1'])).toBe(true);
  });

  it('returns false when there is no collision', () => {
    expect(isDuplicateName('Sprint 3', ['Sprint 1', 'Sprint 2'])).toBe(false);
  });

  it('returns false against an empty list', () => {
    expect(isDuplicateName('Sprint 1', [])).toBe(false);
  });
});
