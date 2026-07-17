import { describe, it, expect } from 'vitest';
import type { SprintView } from '../../src/shared/api.js';
import type { YtIssue, YtSprint } from '../../src/backend/repositories/youtrack-client.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import { app, BOARD_ID, MANAGER, MEMBER, MEMBER_2, PROJECT_ID, request, seedWorld } from './setup.js';

const SPRINT: YtSprint = {
  id: 'sprint-1',
  name: 'AppGlass 2026-S5',
  goal: '',
  start: '2026-03-02',
  finish: '2026-03-13',
  archived: false,
};

function capacity() {
  return makeDoc([
    makeRow({ userId: MEMBER.id, availableMinutes: 4800, defaultMinutes: 4800 }),
    makeRow({ userId: MEMBER_2.id, availableMinutes: 4800, defaultMinutes: 4800 }),
  ]);
}

// A mix of resolved/unresolved/inside/outside-window/missing-original issues.
const ISSUES: YtIssue[] = [
  { id: 'A', originalEffortMinutes: 6000, currentEffortMinutes: 3000, resolved: false, resolvedAt: null },
  { id: 'B', originalEffortMinutes: null, currentEffortMinutes: 1000, resolved: false, resolvedAt: null },
  { id: 'C', originalEffortMinutes: 2000, currentEffortMinutes: 500, resolved: true, resolvedAt: Date.UTC(2026, 2, 10) },
  { id: 'D', originalEffortMinutes: 5000, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 1, 1) },
];

describe('effort aggregation via recalculate', () => {
  it('computes original/current/completed effort with the period + resolution rules', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: SPRINT,
      projectId: PROJECT_ID,
      sequence: 5,
      focusFactor: 0.7,
      capacity: capacity(),
      issues: ISSUES,
    });

    await request(app(fake), 'POST', '/sprints/sprint-1/recalculate');
    const view = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;

    expect(view.originalEffortMinutes).toBe(13000); // 6000 + 2000 + 5000 (B missing -> 0)
    expect(view.currentEffortMinutes).toBe(4000); // 3000 + 1000 (resolved -> 0)
    expect(view.completedOriginalEffortMinutes).toBe(2000); // C resolved within window
    expect(view.issuesMissingOriginalEffort).toEqual(['B']);
    expect(view.rawCapacityMinutes).toBe(9600);
  });
});

describe('reconciliation corrects a corrupted cache', () => {
  it('fixes scpOriginalEffortMinutes and marks the sprint up-to-date', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: SPRINT,
      projectId: PROJECT_ID,
      sequence: 5,
      focusFactor: 0.7,
      capacity: capacity(),
      issues: ISSUES,
      extra: {
        scpOriginalEffortMinutes: 99999, // deliberately wrong cached value
        scpDataIntegrityStatus: 'needs-recalculation',
        scpMetricsDirty: true,
      },
    });

    const before = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(before.originalEffortMinutes).toBe(99999);
    expect(before.dataIntegrityStatus).toBe('needs-recalculation');

    await request(app(fake), 'POST', '/sprints/sprint-1/recalculate');

    const after = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(after.originalEffortMinutes).toBe(13000);
    expect(after.dataIntegrityStatus).toBe('up-to-date');
    // The persisted cache itself was corrected.
    expect(fake.peekExtension('Sprint', 'sprint-1', 'scpOriginalEffortMinutes')).toBe(13000);
    expect(fake.peekExtension('Sprint', 'sprint-1', 'scpDataIntegrityStatus')).toBe('up-to-date');
  });

  it('rejects recalculate from a non-manager', async () => {
    const fake = seedWorld();
    fake.currentUserId = MEMBER.id;
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: SPRINT,
      projectId: PROJECT_ID,
      sequence: 5,
      focusFactor: 0.7,
      capacity: capacity(),
      issues: ISSUES,
    });
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/recalculate');
    expect(res.status).toBe(403);
  });
});
