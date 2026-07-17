import { describe, it, expect } from 'vitest';
import type {
  ApiError,
  BoardSummary,
  ConfigResponse,
  ConfigValidationResponse,
} from '../../src/shared/api.js';
import { app, defaultConfig, MANAGER, MEMBER, PROJECT_ID, request, seedWorld } from './setup.js';

describe('GET /boards', () => {
  it('lists boards with id/name/usesSprints', async () => {
    const fake = seedWorld();
    const res = await request(app(fake), 'GET', '/boards');
    expect(res.status).toBe(200);
    const boards = res.body as BoardSummary[];
    expect(boards).toEqual([{ id: 'board-1', name: 'AppGlass Board', usesSprints: true }]);
  });
});

describe('GET /config', () => {
  it('reports unconfigured when no config is stored', async () => {
    const fake = seedWorld({ configured: false });
    const res = await request(app(fake), 'GET', '/config');
    expect(res.status).toBe(200);
    const body = res.body as ConfigResponse;
    expect(body.configured).toBe(false);
    expect(body.config).toBeNull();
    expect(body.isManager).toBe(false);
  });

  it('returns config and isManager=true for a manager', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'GET', '/config');
    const body = res.body as ConfigResponse;
    expect(body.configured).toBe(true);
    expect(body.config?.boardId).toBe('board-1');
    expect(body.configRevision).toBe(1);
    expect(body.isManager).toBe(true);
  });

  it('returns isManager=false for a non-manager', async () => {
    const fake = seedWorld();
    fake.currentUserId = MEMBER.id;
    const body = (await request(app(fake), 'GET', '/config')).body as ConfigResponse;
    expect(body.isManager).toBe(false);
  });

  it('treats malformed persisted config JSON as unconfigured', async () => {
    const fake = seedWorld({ configured: false });
    fake.seedConfiguredProject({
      projectId: PROJECT_ID,
      config: defaultConfig(),
      rawConfigJson: '{ not valid json',
    });
    const body = (await request(app(fake), 'GET', '/config')).body as ConfigResponse;
    expect(body.configured).toBe(false);
    expect(body.config).toBeNull();
  });
});

describe('PUT /config', () => {
  it('rejects a non-manager with FORBIDDEN', async () => {
    const fake = seedWorld();
    fake.currentUserId = MEMBER.id;
    const res = await request(app(fake), 'PUT', '/config', {
      body: { expectedRevision: 1, config: defaultConfig() },
    });
    expect(res.status).toBe(403);
    expect((res.body as ApiError).code).toBe('FORBIDDEN');
  });

  it('rejects a stale expectedRevision with CONFIG_REVISION_CONFLICT', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PUT', '/config', {
      body: { expectedRevision: 0, config: defaultConfig() },
    });
    expect(res.status).toBe(409);
    expect((res.body as ApiError).code).toBe('CONFIG_REVISION_CONFLICT');
  });

  it('rejects an invalid config (missing board) with VALIDATION_FAILED + problems', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PUT', '/config', {
      body: { expectedRevision: 1, config: defaultConfig({ boardId: 'board-missing' }) },
    });
    expect(res.status).toBe(400);
    const err = res.body as ApiError;
    expect(err.code).toBe('VALIDATION_FAILED');
    const problems = err.details.problems as Array<{ path: string; message: string }>;
    expect(problems.some((p) => p.path === 'boardId')).toBe(true);
  });

  it('rejects a config whose effort field is not a period field', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PUT', '/config', {
      body: {
        expectedRevision: 1,
        config: defaultConfig({ originalEffortField: 'Text Field' }),
      },
    });
    expect(res.status).toBe(400);
    const problems = (res.body as ApiError).details.problems as Array<{ path: string }>;
    expect(problems.some((p) => p.path === 'originalEffortField')).toBe(true);
  });

  it('saves a valid config and bumps the revision', async () => {
    const fake = seedWorld();
    fake.currentUserId = MANAGER.id;
    const res = await request(app(fake), 'PUT', '/config', {
      body: { expectedRevision: 1, config: defaultConfig({ hoursPerDay: 6 }) },
    });
    expect(res.status).toBe(200);
    expect((res.body as { configRevision: number }).configRevision).toBe(2);
    // Persisted revision is observable on the next load.
    const after = (await request(app(fake), 'GET', '/config')).body as ConfigResponse;
    expect(after.configRevision).toBe(2);
    expect(after.config?.hoursPerDay).toBe(6);
  });
});

describe('GET /config/validation', () => {
  it('is invalid when unconfigured', async () => {
    const fake = seedWorld({ configured: false });
    const body = (await request(app(fake), 'GET', '/config/validation'))
      .body as ConfigValidationResponse;
    expect(body.valid).toBe(false);
    expect(body.problems.length).toBeGreaterThan(0);
  });

  it('is valid for a healthy stored config', async () => {
    const fake = seedWorld();
    const body = (await request(app(fake), 'GET', '/config/validation'))
      .body as ConfigValidationResponse;
    expect(body.valid).toBe(true);
    expect(body.problems).toEqual([]);
  });

  it('reflects board/field problems in a stored-but-broken config', async () => {
    const fake = seedWorld({ config: defaultConfig({ boardId: 'board-missing' }) });
    const body = (await request(app(fake), 'GET', '/config/validation'))
      .body as ConfigValidationResponse;
    expect(body.valid).toBe(false);
    expect(body.problems.some((p) => p.path === 'boardId')).toBe(true);
  });
});
