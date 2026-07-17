/**
 * Real-YouTrack integration tests (§25.4).
 *
 * These drive the live REST API of a LOCAL YouTrack instance (stood up by the
 * harness) and assert the app's end-to-end behaviours. The whole suite self-skips
 * when YT_TEST_BASE_URL is unset, so `npm run test:contract`/CI without an instance
 * stays green. It is exercised for real via `npm run test:integration:real`, which
 * provisions -> seeds -> runs -> cleans up.
 *
 * SPIKE: several endpoints (extension-property read/write, app install, group
 * membership) are SDK/version-specific and mirror the SPIKEs in
 * src/backend/repositories/youtrack-http-client.ts. Assertions on those are marked.
 */
import { beforeAll, afterAll, expect, it } from 'vitest';
import { describeReal, makeClient, makeRunId, field, readRealEnv, type RestClient } from './helpers';

describeReal('real YouTrack integration', () => {
  const env = readRealEnv();
  let client: RestClient;
  const runId = makeRunId();
  const created: { projectId?: string; boardId?: string } = {};

  beforeAll(async () => {
    expect(env.allowDestructive, 'YT_TEST_ALLOW_DESTRUCTIVE=true required').toBe(true);
    client = makeClient();
    // Readiness probe.
    const me = await client.get('/api/users/me', { fields: 'id,login' });
    expect(field(me, 'login')).toBeTruthy();
  });

  afterAll(async () => {
    // Isolation cleanup — tolerate partial state; never throw out of teardown.
    if (created.boardId) {
      await client.del(`/api/agiles/${encodeURIComponent(created.boardId)}`).catch(() => undefined);
    }
    if (created.projectId) {
      await client
        .del(`/api/admin/projects/${encodeURIComponent(created.projectId)}`)
        .catch(() => undefined);
    }
  });

  it('creates an isolated project and a sprint-enabled board (§25.4)', async () => {
    const me = await client.get('/api/users/me', { fields: 'id' });
    const leaderId = field(me, 'id');

    const shortName = `${env.projectPrefix}_${runId}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 30);
    const project = await client.post(
      '/api/admin/projects',
      { name: `SCP IT ${runId}`, shortName, ...(leaderId ? { leader: { id: leaderId } } : {}) },
      { fields: 'id,shortName' },
    );
    created.projectId = field(project, 'id');
    expect(created.projectId).toBeTruthy();

    const projectId = created.projectId as string;
    const board = await client.post(
      '/api/agiles',
      { name: `SCP IT Board ${runId}`, projects: [{ id: projectId }], sprintsSettings: { disableSprints: false } },
      { fields: 'id,sprintsSettings(disableSprints)' },
    );
    created.boardId = field(board, 'id');
    expect(created.boardId).toBeTruthy();
  });

  it('creates and reads back a sprint on the board (§25.4)', async () => {
    expect(created.boardId, 'board must exist from the previous test').toBeTruthy();
    const boardId = created.boardId as string;

    const created1 = await client.post(
      `/api/agiles/${encodeURIComponent(boardId)}/sprints`,
      { name: `Sprint 1 ${runId}`, goal: 'integration' },
      { fields: 'id,name,goal' },
    );
    const sprintId = field(created1, 'id');
    expect(sprintId).toBeTruthy();

    const readBack = await client.get(
      `/api/agiles/${encodeURIComponent(boardId)}/sprints/${encodeURIComponent(sprintId as string)}`,
      { fields: 'id,name,goal' },
    );
    expect(field(readBack, 'name')).toContain('Sprint 1');
  });

  it.todo(
    'reads/writes scp* extension properties on a Sprint (SPIKE: app extension-property REST path)',
  );

  it.todo('installs the packaged app and drives a backend endpoint (SPIKE: app install REST path)');
});
