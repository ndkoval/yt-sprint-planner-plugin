import { describe, it, expect } from 'vitest';
import type { ApiError, SprintView } from '../../src/shared/api.js';
import type { FocusFactorOverride } from '../../src/shared/types.js';
import type { YtSprint } from '../../src/backend/repositories/youtrack-client.js';
import { makeDoc, makeRow } from '../fixtures/capacity.js';
import { app, BOARD_ID, MANAGER, MEMBER, PROJECT_ID, request, seedWorld } from './setup.js';

const SPRINT: YtSprint = {
  id: 'sprint-1',
  name: 'AppGlass 2026-S1',
  goal: '',
  start: '2026-01-05',
  finish: '2026-01-18',
  archived: false,
};

function setup(currentUserId: string) {
  const fake = seedWorld();
  fake.currentUserId = currentUserId;
  fake.seedManagedSprint({
    boardId: BOARD_ID,
    sprint: SPRINT,
    projectId: PROJECT_ID,
    sequence: 1,
    focusFactor: 0.7,
    focusFactorSource: 'bootstrap',
    capacity: makeDoc([makeRow({ userId: MEMBER.id })]),
  });
  return fake;
}

describe('POST /sprints/:id/focus-factor/override', () => {
  it('records reason/old/new and switches source to manual (manager only)', async () => {
    const fake = setup(MANAGER.id);
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/focus-factor/override', {
      body: { reason: 'Holiday-heavy sprint', newValue: 0.55 },
    });
    expect(res.status).toBe(200);
    // The mutation now returns the full updated SprintView (matching the widget contract).
    const body = res.body as SprintView;
    const override = body.focusFactorOverride as FocusFactorOverride;
    expect(override.oldValue).toBe(0.7);
    expect(override.newValue).toBe(0.55);
    expect(override.reason).toBe('Holiday-heavy sprint');
    expect(override.userId).toBe(MANAGER.id);
    expect(body.focusFactor).toBe(0.55);
    expect(body.focusFactorSource).toBe('manual');

    const view = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(view.focusFactor).toBe(0.55);
    expect(view.focusFactorSource).toBe('manual');
    expect(view.focusFactorOverride?.reason).toBe('Holiday-heavy sprint');
  });

  it('forbids a non-manager', async () => {
    const fake = setup(MEMBER.id);
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/focus-factor/override', {
      body: { reason: 'x', newValue: 0.5 },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });
});

describe('calibration exclude / include', () => {
  it('excludes then includes a sprint (manager only)', async () => {
    const fake = setup(MANAGER.id);
    const excluded = await request(app(fake), 'POST', '/sprints/sprint-1/calibration/exclude', {
      body: { reason: 'Anomalous data' },
    });
    expect(excluded.status).toBe(200);
    let view = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(view.excludedFromCalibration).toBe(true);
    expect(view.calibrationSkipReason).toBe('Anomalous data');

    await request(app(fake), 'POST', '/sprints/sprint-1/calibration/include');
    view = (await request(app(fake), 'GET', '/sprints/sprint-1')).body as SprintView;
    expect(view.excludedFromCalibration).toBe(false);
    expect(view.calibrationSkipReason).toBeNull();
  });

  it('forbids a non-manager from excluding', async () => {
    const fake = setup(MEMBER.id);
    const res = await request(app(fake), 'POST', '/sprints/sprint-1/calibration/exclude', {
      body: { reason: 'x' },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });
});
