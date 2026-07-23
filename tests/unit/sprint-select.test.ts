import { describe, expect, it } from 'vitest';
import { pickRelevantSprint, type SelectableSprint } from '../../src/domain/sprint/select.js';

function s(over: Partial<SelectableSprint>): SelectableSprint {
  return { id: 'x', start: '', finish: '', archived: false, managed: true, sequence: 1, ...over };
}

describe('pickRelevantSprint', () => {
  it('returns null for an empty list', () => {
    expect(pickRelevantSprint([], '2026-07-23')).toBeNull();
  });

  it('prefers the ACTIVE managed sprint (today within its dates)', () => {
    const list = [
      s({ id: 'past', start: '2026-06-01', finish: '2026-06-14', sequence: 1 }),
      s({ id: 'now', start: '2026-07-20', finish: '2026-08-02', sequence: 2 }),
      s({ id: 'future', start: '2026-08-03', finish: '2026-08-16', sequence: 3 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('now');
  });

  it('is inclusive of the start and finish days', () => {
    const list = [s({ id: 'edge', start: '2026-07-23', finish: '2026-08-05', sequence: 1 })];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('edge');
    expect(pickRelevantSprint(list, '2026-08-05')?.id).toBe('edge');
    expect(pickRelevantSprint(list, '2026-08-06')?.id).toBe('edge'); // falls back to latest managed
  });

  it('picks the highest-sequence active sprint when several overlap', () => {
    const list = [
      s({ id: 'a', start: '2026-07-01', finish: '2026-07-31', sequence: 5 }),
      s({ id: 'b', start: '2026-07-20', finish: '2026-07-25', sequence: 9 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('b');
  });

  it('falls back to the latest managed sprint by sequence when none is active', () => {
    const list = [
      s({ id: 'old', start: '2026-05-01', finish: '2026-05-14', sequence: 1 }),
      s({ id: 'new', start: '2026-06-01', finish: '2026-06-14', sequence: 2 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('new');
  });

  it('ignores archived and unmanaged sprints for the active/latest choice', () => {
    const list = [
      s({ id: 'archived-active', start: '2026-07-20', finish: '2026-08-02', sequence: 9, archived: true }),
      s({ id: 'unmanaged-active', start: '2026-07-20', finish: '2026-08-02', sequence: 8, managed: false }),
      s({ id: 'managed-old', start: '2026-06-01', finish: '2026-06-14', sequence: 2 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('managed-old');
  });

  it('falls back to the first non-archived sprint when nothing is managed', () => {
    const list = [
      s({ id: 'arch', managed: false, archived: true, sequence: 1 }),
      s({ id: 'live', managed: false, archived: false, sequence: 2 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('live');
  });

  it('falls back to the very first sprint when all are archived and unmanaged', () => {
    const list = [
      s({ id: 'first', managed: false, archived: true, sequence: 1 }),
      s({ id: 'second', managed: false, archived: true, sequence: 2 }),
    ];
    expect(pickRelevantSprint(list, '2026-07-23')?.id).toBe('first');
  });
});
