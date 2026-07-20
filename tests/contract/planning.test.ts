import { describe, it, expect } from 'vitest';
import type { ApiError, IssueView, SprintView } from '../../src/shared/api.js';
import type { YtSprint } from '../../src/backend/repositories/youtrack-client.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import {
  app,
  BOARD_ID,
  MANAGER,
  MEMBER,
  MEMBER_2,
  PROJECT_ID,
  defaultConfig,
  request,
  seedWorld,
} from './setup.js';

const SPRINT: YtSprint = {
  id: 'sprint-1',
  name: 'AppGlass 2026-S1',
  goal: '',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

function setup() {
  const fake = seedWorld({ config: defaultConfig({ backlogQuery: '#Unresolved' }) });
  fake.seedManagedSprint({
    boardId: BOARD_ID,
    sprint: SPRINT,
    projectId: PROJECT_ID,
    sequence: 1,
    focusFactor: 0.7,
    capacity: makeDoc([
      makeRow({ userId: MEMBER.id, availableMinutes: 4800, defaultMinutes: 4800 }),
      makeRow({ userId: MEMBER_2.id, availableMinutes: 4800, defaultMinutes: 4800 }),
    ]),
    issues: [
      { id: 'IN-1', originalEffortMinutes: 480, currentEffortMinutes: 480, resolved: false, resolvedAt: null, assigneeId: MEMBER.id },
      { id: 'IN-2', originalEffortMinutes: 480, currentEffortMinutes: 480, resolved: false, resolvedAt: null, assigneeId: null },
    ],
  });
  fake.seedBacklog([
    { id: 'BL-1', idReadable: 'AGP-101', summary: 'Backlog one', originalEffortMinutes: 240, currentEffortMinutes: 240, resolved: false, resolvedAt: null, assigneeId: null },
    { id: 'BL-2', idReadable: 'AGP-102', summary: 'Backlog two', originalEffortMinutes: 480, currentEffortMinutes: 480, resolved: false, resolvedAt: null, assigneeId: null },
  ]);
  return fake;
}

describe('GET /sprints/:id/backlog', () => {
  it('returns the configured backlog, excluding issues already in the Sprint', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'GET', '/sprints/sprint-1/backlog');
    expect(res.status).toBe(200);
    const backlog = res.body as IssueView[];
    expect(backlog.map((i) => i.id).sort()).toEqual(['BL-1', 'BL-2']);
    expect(backlog[0]!.idReadable).toBe('AGP-101');
  });

  it('is empty when no backlog query is configured', async () => {
    const fake = seedWorld({ config: defaultConfig({ backlogQuery: '' }) });
    fake.seedManagedSprint({
      boardId: BOARD_ID, sprint: SPRINT, projectId: PROJECT_ID, sequence: 1, focusFactor: 0.7,
      capacity: makeDoc([makeRow({ userId: MEMBER.id })]),
    });
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'GET', '/sprints/sprint-1/backlog');
    expect(res.status).toBe(200);
    expect(res.body as IssueView[]).toEqual([]);
  });
});

describe('POST /sprints/:id/issues/:issueId/plan', () => {
  it('pulls a backlog issue into the Sprint and assigns it', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/issues/BL-1/plan', {
      body: { inSprint: true, assigneeId: MEMBER_2.id },
    });
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    // Backlog issue now counts toward MEMBER_2's assigned effort.
    expect(view.assignedEffort[MEMBER_2.id]?.originalEffortMinutes).toBe(240);
    // And it's no longer in the backlog.
    const backlog = (await request(app(fake), 'GET', '/sprints/sprint-1/backlog')).body as IssueView[];
    expect(backlog.map((i) => i.id)).toEqual(['BL-2']);
  });

  it('removes an issue from the Sprint back to the backlog', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/issues/IN-1/plan', {
      body: { inSprint: false, assigneeId: null },
    });
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    expect(view.assignedEffort[MEMBER.id]?.originalEffortMinutes ?? 0).toBe(0);
  });

  it('unassigns an in-Sprint issue when dropped on Unassigned', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/issues/IN-1/plan', {
      body: { inSprint: true, assigneeId: null },
    });
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    expect(view.assignedEffort[MEMBER.id]?.originalEffortMinutes ?? 0).toBe(0);
    expect(view.unassignedEffort.originalEffortMinutes).toBeGreaterThanOrEqual(480);
  });

  it('is manager-only', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/issues/BL-1/plan', {
      body: { inSprint: true, assigneeId: MEMBER_2.id },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });
});

describe('PATCH /sprints/:id/issues/:issueId', () => {
  it('updates an in-Sprint issue’s effort and assignee (manager)', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/issues/IN-2', {
      body: { originalEffortMinutes: 960, currentEffortMinutes: 720, assigneeId: MEMBER_2.id },
    });
    expect(res.status).toBe(200);
    const view = res.body as SprintView;
    expect(view.assignedEffort[MEMBER_2.id]?.originalEffortMinutes).toBe(960);
    const issues = (await request(app(fake), 'GET', '/sprints/sprint-1/issues')).body as IssueView[];
    const updated = issues.find((i) => i.id === 'IN-2');
    expect(updated?.originalEffortMinutes).toBe(960);
    expect(updated?.currentEffortMinutes).toBe(720);
    expect(updated?.assigneeId).toBe(MEMBER_2.id);
  });

  it('clears an effort field when passed null', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/issues/IN-1', {
      body: { originalEffortMinutes: null },
    });
    expect(res.status).toBe(200);
    const issues = (await request(app(fake), 'GET', '/sprints/sprint-1/issues')).body as IssueView[];
    expect(issues.find((i) => i.id === 'IN-1')?.originalEffortMinutes).toBeNull();
  });

  it('is manager-only', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/issues/IN-1', {
      body: { originalEffortMinutes: 60 },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });

  it('rejects editing an issue that is not in the Sprint (no arbitrary-issue writes)', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/issues/BL-1', {
      body: { originalEffortMinutes: 60 },
    });
    expect(res.status).toBe(404);
  });
});

