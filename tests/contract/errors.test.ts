import { describe, it, expect } from 'vitest';
import type { ApiError, SprintView } from '../../src/shared/api.js';
import type { YtSprint } from '../../src/backend/repositories/youtrack-client.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import { app, BOARD_ID, MEMBER, PROJECT_ID, request, seedWorld } from './setup.js';

const SPRINT: YtSprint = {
  id: 'sprint-1',
  name: 'AppGlass 2026-S1',
  goal: '',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

function expectSafeEnvelope(body: unknown): ApiError {
  const err = body as ApiError;
  expect(typeof err.code).toBe('string');
  expect(typeof err.message).toBe('string');
  expect(typeof err.correlationId).toBe('string');
  expect(err.details).toBeDefined();
  // Never leak an internal stack trace.
  expect((body as Record<string, unknown>).stack).toBeUndefined();
  expect(err.message).not.toMatch(/\bat\s+.+:\d+:\d+/);
  return err;
}

describe('routing and request validation', () => {
  it('returns NOT_FOUND for an unknown route', async () => {
    const fake = seedWorld();
    const res = await request(app(fake), 'GET', '/does-not-exist');
    expect(res.status).toBe(404);
    expect(expectSafeEnvelope(res.body).code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION_FAILED when projectId is missing', async () => {
    const fake = seedWorld();
    const res = await app(fake).handle({ method: 'GET', path: '/config', query: {}, body: null });
    expect(res.status).toBe(400);
    expect(expectSafeEnvelope(res.body).code).toBe('VALIDATION_FAILED');
  });

  it('returns NOT_CONFIGURED for context routes on an unconfigured project', async () => {
    const fake = seedWorld({ configured: false });
    const res = await request(app(fake), 'GET', '/sprints');
    expect(res.status).toBe(409);
    expect(expectSafeEnvelope(res.body).code).toBe('NOT_CONFIGURED');
  });
});

describe('transport failures become a safe INTERNAL_ERROR envelope', () => {
  it('wraps a throw during current-user resolution', async () => {
    const fake = seedWorld();
    fake.faults.add('getCurrentUser');
    const res = await request(app(fake), 'GET', '/config');
    expect(res.status).toBe(500);
    const err = expectSafeEnvelope(res.body);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('An unexpected error occurred.');
  });

  it('wraps a throw while fetching sprint issues', async () => {
    const fake = seedWorld();
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: SPRINT,
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
      capacity: makeDoc([makeRow({ userId: MEMBER.id })]),
    });
    fake.faults.add('getSprintIssues');
    const res = await request(app(fake), 'GET', '/sprints/sprint-1');
    expect(res.status).toBe(500);
    expect(expectSafeEnvelope(res.body).code).toBe('INTERNAL_ERROR');
  });
});

describe('malformed persisted capacity JSON', () => {
  it('is tolerated on read but blocks capacity edits with NOT_FOUND', async () => {
    const fake = seedWorld();
    fake.currentUserId = MEMBER.id;
    fake.seedManagedSprint({
      boardId: BOARD_ID,
      sprint: SPRINT,
      projectId: PROJECT_ID,
      sequence: 1,
      focusFactor: 0.7,
    });
    fake.pokeExtension('Sprint', 'sprint-1', 'scpCapacityJson', '{ broken');

    const view = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(view.capacity.rows).toEqual({});

    const patch = await request(app(fake), 'PATCH', '/sprints/sprint-1/capacity/me', {
      body: { expectedRevision: 0, availableMinutes: 100 },
    });
    expect(patch.status).toBe(404);
    expect((patch.body as ApiError).code).toBe('NOT_FOUND');
  });
});
