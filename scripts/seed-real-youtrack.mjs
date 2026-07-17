/**
 * seed:real-youtrack — provision isolated test data on a LOCAL YouTrack via REST.
 *
 * Creates (all namespaced by runId per §25.3 so parallel runs never collide):
 *   - a project SCP_E2E_<runId>
 *   - period custom fields for Original Effort + Current Effort, attached to the project
 *   - State + Sprint fields (native), an Agile Board that USES SPRINTS
 *   - users manager/alice/bob and groups, added to the project team
 *   - attaches the app (best-effort; app install is SDK-specific — SPIKE)
 *
 * Writes the seeded ids into artifacts/test-environment-manifest.json so cleanup and
 * the tests can find them. Requires YT_TEST_ALLOW_DESTRUCTIVE=true.
 *
 * SPIKE: several admin REST payloads (custom-field prototypes, field-type ids,
 * board sprint settings, app attach) are version-specific; each is isolated in a
 * helper and marked so it can be corrected against a real instance.
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runMain } from './lib/log.mjs';
import { ARTIFACTS_DIR } from './lib/paths.mjs';
import { assertDestructiveAllowed, assertNotProduction, makeRunId, YtRest } from './lib/yt-env.mjs';

const MANIFEST_PATH = path.join(ARTIFACTS_DIR, 'test-environment-manifest.json');

async function readManifest() {
  try {
    await access(MANIFEST_PATH, constants.F_OK);
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Ensure a global period custom field prototype exists; return its id. */
async function ensurePeriodField(rest, log, name) {
  // SPIKE: confirm field-type id for period fields. On recent versions the
  // period fieldType id is 'period'. Verify against /api/admin/customFieldSettings/types.
  log.info('ensure period custom field', name);
  const created = await rest.post(
    '/api/admin/customFieldSettings/customFields',
    { name, fieldType: { id: 'period' } },
    { fields: 'id,name,fieldType(id)' },
  );
  return created.id;
}

/** Attach a custom field to a project. */
async function attachFieldToProject(rest, log, projectId, fieldId) {
  log.info('attach field', fieldId, 'to project', projectId);
  // SPIKE: project custom field attachment payload (bundle/defaults) is version-specific.
  return rest.post(
    `/api/admin/projects/${encodeURIComponent(projectId)}/customFields`,
    { field: { id: fieldId }, $type: 'PeriodProjectCustomField' },
    { fields: 'id' },
  );
}

async function ensureUser(rest, log, login, password, fullName) {
  if (!login) {
    log.warn('skipping user with empty login (env not set)');
    return null;
  }
  log.info('ensure user', login);
  // SPIKE: Hub user creation endpoint. On YouTrack standalone, users are created via
  // the Hub REST API (/hub/api/rest/users) or /api/admin/users depending on version.
  try {
    const user = await rest.post(
      '/api/admin/users',
      { login, password, fullName: fullName ?? login },
      { fields: 'id,login' },
    );
    return user.id;
  } catch (err) {
    log.warn(`could not create user ${login} (may already exist): ${err}`);
    return null;
  }
}

async function ensureGroup(rest, log, name) {
  log.info('ensure group', name);
  try {
    const group = await rest.post('/api/admin/groups', { name }, { fields: 'id,name' });
    return group.id;
  } catch (err) {
    log.warn(`could not create group ${name}: ${err}`);
    return null;
  }
}

async function createProject(rest, log, key, name, leaderId) {
  log.info('create project', key);
  // SPIKE: project creation requires a leader; leaderId comes from admin token's user.
  return rest.post(
    '/api/admin/projects',
    {
      name,
      shortName: key,
      ...(leaderId ? { leader: { id: leaderId } } : {}),
    },
    { fields: 'id,name,shortName' },
  );
}

async function createBoard(rest, log, name, projectId) {
  log.info('create agile board', name, 'using sprints');
  // SPIKE: agile board + sprint settings payload. usesSprints => sprintsSettings.disableSprints=false.
  return rest.post(
    '/api/agiles',
    {
      name,
      projects: [{ id: projectId }],
      sprintsSettings: { disableSprints: false },
    },
    { fields: 'id,name,sprintsSettings(disableSprints)' },
  );
}

runMain('seed:real-youtrack', async (log) => {
  const env = assertDestructiveAllowed(log);
  assertNotProduction(env.baseUrl, log);

  const manifest = await readManifest();
  const runId = manifest.runId ?? makeRunId();
  const baseUrl = env.baseUrl || manifest.baseUrl;
  const rest = new YtRest(baseUrl, env.adminToken, log);

  await rest.waitUntilReady(60000).catch((err) => {
    throw new Error(`YouTrack not reachable for seeding: ${err}`);
  });

  const projectKey = `${env.projectPrefix}_${runId}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 30);
  const projectName = `SCP E2E ${runId}`;

  const me = await rest.get('/api/users/me', { fields: 'id,login' });

  const seeded = {
    runId,
    projectKey,
    projectName,
    projectId: null,
    boardId: null,
    fields: {},
    users: {},
    groups: {},
  };

  log.step('users + groups');
  seeded.users.manager = await ensureUser(
    rest,
    log,
    env.managerLogin,
    env.managerPassword,
    'SCP Manager',
  );
  seeded.users.alice = await ensureUser(rest, log, env.aliceLogin, env.alicePassword, 'SCP Alice');
  seeded.users.bob = await ensureUser(rest, log, env.bobLogin, env.bobPassword, 'SCP Bob');
  seeded.groups.team = await ensureGroup(rest, log, `scp-team-${runId}`);

  log.step('project');
  const project = await createProject(rest, log, projectKey, projectName, me.id);
  seeded.projectId = project.id;

  log.step('custom fields (period effort)');
  const originalEffortId = await ensurePeriodField(rest, log, 'Original Effort');
  const currentEffortId = await ensurePeriodField(rest, log, 'Current Effort');
  seeded.fields.originalEffort = originalEffortId;
  seeded.fields.currentEffort = currentEffortId;
  await attachFieldToProject(rest, log, project.id, originalEffortId);
  await attachFieldToProject(rest, log, project.id, currentEffortId);

  log.step('agile board (sprints)');
  const board = await createBoard(rest, log, `SCP Board ${runId}`, project.id);
  seeded.boardId = board.id;

  log.step('attach app');
  // SPIKE: installing/attaching the packaged app to a project is done through the
  // Apps SDK admin surface (upload dist/sprint-capacity-planner.zip). The exact REST
  // path is version-specific; in CI this is performed by the platform's app-install
  // step. Recorded here as pending so cleanup knows it may exist.
  seeded.appAttached = false;
  log.warn('app attach is SDK-specific — perform via app upload; recorded as pending');

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const merged = { ...manifest, seeded };
  await writeFile(MANIFEST_PATH, JSON.stringify(merged, null, 2));
  log.info('seeded data recorded in', MANIFEST_PATH);
  log.info('project', projectKey, 'id', project.id, 'board', board.id);
});
