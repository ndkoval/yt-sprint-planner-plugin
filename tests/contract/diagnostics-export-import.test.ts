import { describe, it, expect } from 'vitest';
import type { ApiError, ConfigResponse, DiagnosticsResponse, SprintSummary } from '../../src/shared/api.js';
import type { ExportBundle, ImportResult } from '../../src/backend/services/export-import-service.js';
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

function withManagedSprint(currentUserId: string) {
  const fake = seedWorld();
  fake.currentUserId = currentUserId;
  fake.seedManagedSprint({
    boardId: BOARD_ID,
    sprint: SPRINT,
    projectId: PROJECT_ID,
    sequence: 1,
    focusFactor: 0.7,
    capacity: makeDoc([makeRow({ userId: MEMBER.id })]),
  });
  return fake;
}

describe('GET /diagnostics', () => {
  it('forbids a non-manager', async () => {
    const fake = withManagedSprint(MEMBER.id);
    const res = await request(app(fake), 'GET', '/diagnostics');
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });

  it('summarises managed sprint health for a manager', async () => {
    const fake = withManagedSprint(MANAGER.id);
    const res = await request(app(fake), 'GET', '/diagnostics');
    expect(res.status).toBe(200);
    const body = res.body as DiagnosticsResponse;
    expect(body.managedSprintCount).toBe(1);
    expect(typeof body.correlationId).toBe('string');
  });
});

describe('GET /export', () => {
  it('forbids a non-manager', async () => {
    const fake = withManagedSprint(MEMBER.id);
    const res = await request(app(fake), 'GET', '/export');
    expect(res.status).toBe(403);
  });

  it('exports config plus managed sprint metadata for a manager', async () => {
    const fake = withManagedSprint(MANAGER.id);
    const res = await request(app(fake), 'GET', '/export');
    expect(res.status).toBe(200);
    const bundle = res.body as ExportBundle;
    expect(bundle.exportVersion).toBe(1);
    expect(bundle.config?.boardId).toBe('board-1');
    expect(bundle.sprints.map((s) => s.id)).toEqual(['sprint-1']);
  });
});

describe('POST /import (dry-run)', () => {
  it('reports conflicts and applies nothing', async () => {
    const fake = withManagedSprint(MANAGER.id);
    const bundle = (await request(app(fake), 'GET', '/export')).body as ExportBundle;

    // Introduce a sprint with no matching native sprint, and a changed config value.
    const ghost = { ...bundle.sprints[0]!, id: 'ghost-sprint' };
    const tampered: ExportBundle = {
      ...bundle,
      config: bundle.config ? { ...bundle.config, hoursPerDay: 99 } : null,
      sprints: [...bundle.sprints, ghost],
    };

    const res = await request(app(fake), 'POST', '/import', {
      query: { dryRun: 'true' },
      body: tampered,
    });
    expect(res.status).toBe(200);
    const result = res.body as ImportResult;
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.importedSprintCount).toBe(0);
    expect(result.conflicts.map((c) => c.sprintId)).toEqual(['ghost-sprint']);

    // Nothing changed: config still original, no new sprint created.
    const cfg = (await request(app(fake), 'GET', '/config')).body as ConfigResponse;
    expect(cfg.config?.hoursPerDay).toBe(8);
    const sprints = (await request(app(fake), 'GET', '/sprints')).body as SprintSummary[];
    expect(sprints.map((s) => s.id)).toEqual(['sprint-1']);
  });

  it('forbids a non-manager', async () => {
    const fake = withManagedSprint(MANAGER.id);
    const bundle = (await request(app(fake), 'GET', '/export')).body as ExportBundle;
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'POST', '/import', {
      query: { dryRun: 'true' },
      body: bundle,
    });
    expect(res.status).toBe(403);
  });
});
