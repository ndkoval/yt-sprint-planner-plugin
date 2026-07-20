import { describe, it, expect } from 'vitest';
import type { ApiError, SprintSummary, SprintView } from '../../src/shared/api.js';
import type { YtSprint } from '../../src/backend/repositories/youtrack-client.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import {
  app,
  BOARD_ID,
  MANAGER,
  MEMBER,
  MEMBER_2,
  PROJECT_ID,
  request,
  seedWorld,
} from './setup.js';

function nativeSprint(overrides: Partial<YtSprint> = {}): YtSprint {
  return {
    id: 'sprint-1',
    name: 'AppGlass 2026-S1',
    goal: 'ship it',
    start: '2026-01-05',
    finish: '2026-01-18',
    archived: false,
    ...overrides,
  };
}

function teamCapacity() {
  return makeDoc([
    makeRow({ userId: MEMBER.id, availableMinutes: 4800, defaultMinutes: 4800 }),
    makeRow({ userId: MEMBER_2.id, availableMinutes: 4800, defaultMinutes: 4800 }),
  ]);
}

describe('GET /sprints', () => {
  it('marks managed sprints and passes through native fields', async () => {
    const fake = seedWorld();
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint(),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
    });
    fake.seedSprint(BOARD_ID, nativeSprint({ id: 'sprint-unmanaged', name: 'Ad-hoc' }));

    const res = await request(app(fake), 'GET', '/sprints');
    expect(res.status).toBe(200);
    const sprints = res.body as SprintSummary[];
    const managed = sprints.find((s) => s.id === 'sprint-1');
    const unmanaged = sprints.find((s) => s.id === 'sprint-unmanaged');
    expect(managed?.managed).toBe(true);
    expect(unmanaged?.managed).toBe(false);
    expect(managed?.start).toBe('2026-01-05');
  });
});

describe('GET /sprints/:id', () => {
  it('returns a SprintView with the missing-original-effort warning list', async () => {
    const fake = seedWorld();
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint(),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: teamCapacity(),
      issues: [
        { id: 'I-1', originalEffortMinutes: 6000, currentEffortMinutes: 3000, resolved: false, resolvedAt: null },
        { id: 'I-2', originalEffortMinutes: null, currentEffortMinutes: 1000, resolved: false, resolvedAt: null },
      ],
    });
    const res = await request(app(fake), 'GET', '/sprints/sprint-1');
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    expect(view.id).toBe('sprint-1');
    expect(view.managed).toBe(true);
    expect(view.issuesMissingOriginalEffort).toEqual(['I-2']);
  });

  it('returns NOT_FOUND for an unknown sprint', async () => {
    const fake = seedWorld();
    const res = await request(app(fake), 'GET', '/sprints/nope');
    expect(res.status).toBe(404);
    expect((res.body as ApiError).code).toBe('NOT_FOUND');
  });
});

describe('POST /sprints/create-next', () => {
  it('rejects a non-manager (who has board permission) with FORBIDDEN', async () => {
    const fake = seedWorld();
    fake.currentUserId = MEMBER.id;
    fake.grantBoardPermission(BOARD_ID, MEMBER.id);
    const res = await request(app(fake), 'POST', '/sprints/create-next', {
      body: { moveUnresolvedIssues: false },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });

  it('rejects a manager without board permission with BOARD_PERMISSION_REQUIRED', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'POST', '/sprints/create-next', {
      body: { moveUnresolvedIssues: false },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('BOARD_PERMISSION_REQUIRED');
  });

  it('creates the first sprint starting today with the default bootstrap focus factor', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.grantBoardPermission(BOARD_ID, MANAGER.id);
    const res = await request(app(fake), 'POST', '/sprints/create-next', {
      body: { goal: 'kick off', moveUnresolvedIssues: false },
    });
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    expect(view.sequence).toBe(1);
    // The first Sprint of a new team starts on "today" (the fixed clock = 2026-06-01)
    // and runs for the configured 14 days.
    expect(view.start).toBe('2026-06-01');
    expect(view.finish).toBe('2026-06-14');
    expect(view.focusFactor).toBe(0.75);
    expect(view.focusFactorSource).toBe('bootstrap');
    // Capacity seeded for enabled participants only, available == default.
    expect(Object.keys(view.capacity.rows).sort()).toEqual([MEMBER.id, MEMBER_2.id]);
    const row = view.capacity.rows[MEMBER.id]!;
    expect(row.availableMinutes).toBe(4800);
    expect(row.availableWasCustomized).toBe(false);
  });

  it('creates a subsequent sprint with continuous dates and a calculated focus factor', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.grantBoardPermission(BOARD_ID, MANAGER.id);
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint(),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: teamCapacity(), // raw 9600
      issues: [
        // Resolved within window with 4800 original -> observed = 4800/9600 = 0.5.
        { id: 'I-1', originalEffortMinutes: 4800, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 0, 10) },
      ],
    });
    const res = await request(app(fake), 'POST', '/sprints/create-next', {
      body: { moveUnresolvedIssues: false },
    });
    const view = res.body as SprintView;
    expect(view.sequence).toBe(2);
    expect(view.start).toBe('2026-01-19'); // prevFinish + 1
    expect(view.finish).toBe('2026-02-01');
    // 0.5 * (0.5 - 0.7) = -0.1 step, clamped -> 0.6.
    expect(view.focusFactor).toBeCloseTo(0.6, 10);
    expect(view.focusFactorSource).toBe('calculated');
  });

  it('carries over unfinished issues into the new Sprint when requested', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.grantBoardPermission(BOARD_ID, MANAGER.id);
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint(),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: teamCapacity(),
      issues: [
        { id: 'U-1', originalEffortMinutes: 1200, currentEffortMinutes: 600, resolved: false, resolvedAt: null },
        { id: 'U-2', originalEffortMinutes: 900, currentEffortMinutes: 900, resolved: false, resolvedAt: null },
        { id: 'D-1', originalEffortMinutes: 600, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 0, 10) },
      ],
    });

    const created = (
      await request(app(fake), 'POST', '/sprints/create-next', {
        body: { moveUnresolvedIssues: true },
      })
    ).body as SprintView;

    // The two unresolved issues moved to the new Sprint; the completed one stayed.
    const newView = (await request(app(fake), 'GET', `/sprints/${created.id}`)).body as SprintView;
    expect(newView.unresolvedIssueCount).toBe(2);
    const oldView = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(oldView.unresolvedIssueCount).toBe(0);
  });

  it('is idempotent: resuming an identical-dates sprint does not duplicate', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.grantBoardPermission(BOARD_ID, MANAGER.id);
    // The "previous" (latest-by-sequence) sprint finishes 2026-01-18, so create-next
    // computes the window 2026-01-19..2026-02-01. A managed sprint already occupies
    // exactly that window -> the create must resume it instead of duplicating.
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint({ id: 'sprint-prev' }),
      projectId: PROJECT_ID,
      sequence: 2,
      focusFactor: 0.7,
      capacity: teamCapacity(),
    });
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint({ id: 'sprint-next', start: '2026-01-19', finish: '2026-02-01' }),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: teamCapacity(),
    });
    const before = ((await request(app(fake), 'GET', '/sprints')).body as SprintSummary[]).length;
    const res = await request(app(fake), 'POST', '/sprints/create-next', {
      body: { moveUnresolvedIssues: false },
    });
    expect(res.status).toBe(200);
    expect((res.body as SprintView).id).toBe('sprint-next');
    const after = ((await request(app(fake), 'GET', '/sprints')).body as SprintSummary[]).length;
    expect(after).toBe(before);
  });
});

describe('PATCH /sprints/:id/details', () => {
  function setup() {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    fake.grantBoardPermission(BOARD_ID, MANAGER.id);
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: nativeSprint(),
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: teamCapacity(),
    });
    return fake;
  }

  it('rejects finish <= start', async () => {
    const fake = setup();
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/details', {
      body: { start: '2026-02-01', finish: '2026-01-01' },
    });
    expect(res.status).toBe(400);
    expect((res.body as ApiError).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an empty (whitespace) name', async () => {
    const fake = setup();
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/details', {
      body: { name: '   ' },
    });
    expect(res.status).toBe(400);
    expect((res.body as ApiError).code).toBe('VALIDATION_FAILED');
  });

  it('updates the native sprint on the happy path', async () => {
    const fake = setup();
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/details', {
      body: { name: 'Renamed Sprint', goal: 'new goal' },
    });
    expect(res.status).toBe(200);
    expect((res.body as SprintView).name).toBe('Renamed Sprint');
    const reread = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(reread.name).toBe('Renamed Sprint');
    expect(reread.goal).toBe('new goal');
  });

  it('rejects a non-manager', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    fake.grantBoardPermission(BOARD_ID, MEMBER.id);
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/details', {
      body: { name: 'Nope' },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });
});
