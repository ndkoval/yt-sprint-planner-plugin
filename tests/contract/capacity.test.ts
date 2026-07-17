import { describe, it, expect } from 'vitest';
import type { ApiError } from '../../src/shared/api.js';
import type { CapacityDocument } from '../../src/shared/types.js';
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

interface CapacityResponse {
  capacity: CapacityDocument;
  capacityRevision: number;
}

const SPRINT: YtSprint = {
  id: 'sprint-1',
  name: 'AppGlass 2026-S1',
  goal: '',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

function setup() {
  const fake = seedWorld();
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
  });
  return fake;
}

describe('PATCH /sprints/:id/capacity/me', () => {
  it('edits the caller own row and bumps the revision', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/capacity/me', {
      body: { expectedRevision: 1, availableMinutes: 3000 },
    });
    expect(res.status).toBe(200);
    const body = res.body as CapacityResponse;
    expect(body.capacityRevision).toBe(2);
    expect(body.capacity.rows[MEMBER.id]!.availableMinutes).toBe(3000);
    expect(body.capacity.rows[MEMBER.id]!.availableWasCustomized).toBe(true);
    // Persisted through the extension store.
    expect(fake.peekExtension('Sprint', 'sprint-1', 'scpCapacityRevision')).toBe(2);
  });

  it('rejects a stale expectedRevision with CAPACITY_REVISION_CONFLICT', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/capacity/me', {
      body: { expectedRevision: 0, availableMinutes: 3000 },
    });
    expect(res.status).toBe(409);
    expect((res.body as ApiError).code).toBe('CAPACITY_REVISION_CONFLICT');
  });

  it('rejects a negative availableMinutes with a safe error envelope', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PATCH', '/sprints/sprint-1/capacity/me', {
      body: { expectedRevision: 1, availableMinutes: -1 },
    });
    // The value is rejected (never persisted) and returned as a structured envelope
    // with no stack trace. Per §24 a schema-invalid body is 400 VALIDATION_FAILED.
    expect(res.status).toBe(400);
    const err = res.body as ApiError;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect((res.body as Record<string, unknown>).stack).toBeUndefined();
    // The row was not mutated.
    expect(fake.peekExtension('Sprint', 'sprint-1', 'scpCapacityRevision')).toBe(1);
  });
});

describe('PATCH /sprints/:id/capacity/:userId', () => {
  it('forbids a non-manager editing another user row', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PATCH', `/sprints/sprint-1/capacity/${MEMBER_2.id}`, {
      body: { expectedRevision: 1, availableMinutes: 100 },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });

  it('allows a manager to edit another user row', async () => {
    const fake = setup();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PATCH', `/sprints/sprint-1/capacity/${MEMBER_2.id}`, {
      body: { expectedRevision: 1, availableMinutes: 100, note: 'PTO' },
    });
    expect(res.status).toBe(200);
    const body = res.body as CapacityResponse;
    expect(body.capacity.rows[MEMBER_2.id]!.availableMinutes).toBe(100);
    expect(body.capacity.rows[MEMBER_2.id]!.note).toBe('PTO');
    expect(body.capacity.rows[MEMBER_2.id]!.updatedBy).toBe(MANAGER.id);
  });
});

describe('confirm / unconfirm / reset', () => {
  it('confirms then unconfirms the caller row', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const confirmed = (
      await request(app(fake), 'POST', '/sprints/sprint-1/capacity/me/confirm', {
        body: { expectedRevision: 1 },
      })
    ).body as CapacityResponse;
    expect(confirmed.capacity.rows[MEMBER.id]!.confirmed).toBe(true);

    const unconfirmed = (
      await request(app(fake), 'POST', '/sprints/sprint-1/capacity/me/unconfirm', {
        body: { expectedRevision: confirmed.capacityRevision },
      })
    ).body as CapacityResponse;
    expect(unconfirmed.capacity.rows[MEMBER.id]!.confirmed).toBe(false);
  });

  it('rejects a stale revision on confirm with 409', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/capacity/me/confirm', {
      body: { expectedRevision: 99 },
    });
    expect(res.status).toBe(409);
  });

  it('resets a customised row back to its default', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const patched = (
      await request(app(fake), 'PATCH', '/sprints/sprint-1/capacity/me', {
        body: { expectedRevision: 1, availableMinutes: 3000 },
      })
    ).body as CapacityResponse;
    const reset = (
      await request(app(fake), 'POST', `/sprints/sprint-1/capacity/${MEMBER.id}/reset`, {
        body: { expectedRevision: patched.capacityRevision },
      })
    ).body as CapacityResponse;
    expect(reset.capacity.rows[MEMBER.id]!.availableMinutes).toBe(4800);
    expect(reset.capacity.rows[MEMBER.id]!.availableWasCustomized).toBe(false);
  });

  it('rejects a stale revision on reset with 409', async () => {
    const fake = setup();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'POST', `/sprints/sprint-1/capacity/${MEMBER.id}/reset`, {
      body: { expectedRevision: 99 },
    });
    expect(res.status).toBe(409);
  });
});
