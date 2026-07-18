/**
 * setup-real-youtrack-demo — make a running real YouTrack fully demo-ready for the app:
 *   1. period effort fields (Original/Current Effort) attached to the project
 *   2. an agile board with sprints + issues (states, assignees, effort)
 *   3. the app: configure its backend token (AppGlobalStorage) + PUT /config for the project
 *
 * Idempotent-ish (safe to re-run against a fresh instance). Talks to YouTrack REST with a
 * permanent token and to the app via its extensionEndpoints tunnel. Env:
 *   YT_TEST_BASE_URL (default http://localhost:8080), YT_TEST_ADMIN_TOKEN (or --token file)
 * Prints a JSON summary { projectId, boardId, sprintId, configured }.
 */
import { readFileSync } from 'node:fs';

const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const TOKEN =
  process.env.YT_TEST_ADMIN_TOKEN ??
  (() => {
    try { return readFileSync('/tmp/yt25-token.txt', 'utf8').trim(); } catch { return ''; }
  })();
const APP = 'sprint-capacity-planner';
const TUNNEL = `${B}/api/extensionEndpoints/${APP}/backend/api`;

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const log = (...a) => console.log('[setup]', ...a);

async function rest(method, path, body, query) {
  const url = new URL(path.replace(/^\//, ''), B.replace(/\/?$/, '/'));
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  const json = text.length > 0 ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`REST ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

/** Call the app backend through its tunnel (real method + app path in the envelope). */
async function app(method, path, body) {
  const res = await fetch(TUNNEL, { method: 'POST', headers: H, body: JSON.stringify({ method, path, body }) });
  const env = await res.json();
  return env; // { status, body }
}

async function ensureProject(name, shortName) {
  const existing = await rest('GET', '/api/admin/projects', undefined, { fields: 'id,shortName', '$top': '200' });
  const hit = Array.isArray(existing) ? existing.find((p) => p.shortName === shortName) : null;
  if (hit) return hit.id;
  const me = await rest('GET', '/api/users/me', undefined, { fields: 'id' });
  const p = await rest('POST', '/api/admin/projects', { name, shortName, leader: { id: me.id } }, { fields: 'id,shortName' });
  return p.id;
}

async function ensurePeriodField(name) {
  // Global custom field prototype of type period.
  const fields = await rest('GET', '/api/admin/customFieldSettings/customFields', undefined, {
    fields: 'id,name,fieldType(id)', '$top': '300',
  });
  const hit = Array.isArray(fields) ? fields.find((f) => f.name === name) : null;
  if (hit) return hit.id;
  const created = await rest(
    'POST',
    '/api/admin/customFieldSettings/customFields',
    { name, fieldType: { id: 'period', $type: 'FieldType' }, $type: 'CustomField' },
    { fields: 'id,name' },
  );
  return created.id;
}

async function attachPeriodField(projectId, fieldId) {
  const attached = await rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, {
    fields: 'field(id,name)', '$top': '100',
  });
  if (Array.isArray(attached) && attached.some((f) => f.field?.id === fieldId)) return;
  await rest(
    'POST',
    `/api/admin/projects/${projectId}/customFields`,
    { field: { id: fieldId }, $type: 'PeriodProjectCustomField', canBeEmpty: true, emptyFieldText: '—' },
    { fields: 'id' },
  );
}

async function findStateFieldId(projectId) {
  const fields = await rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, {
    fields: 'field(id,name)', '$top': '100',
  });
  const st = fields.find((f) => f.field?.name === 'State');
  return st?.field?.id ?? null;
}

async function ensureBoard(projectId, name, stateFieldId) {
  const boards = await rest('GET', '/api/agiles', undefined, { fields: 'id,name,sprints(id,name)', '$top': '100' });
  const hit = Array.isArray(boards) ? boards.find((b) => b.name === name) : null;
  if (hit) return { id: hit.id, sprints: hit.sprints ?? [] };
  const b = await rest(
    'POST',
    '/api/agiles',
    {
      name,
      projects: [{ id: projectId }],
      columnSettings: { field: { id: stateFieldId } },
      sprintsSettings: { disableSprints: false, cardOnSeveralSprints: false },
    },
    { fields: 'id,name,currentSprint(id,name),sprints(id,name)' },
  );
  return { id: b.id, sprints: b.sprints ?? [] };
}

async function ensureSprint(boardId, name) {
  const board = await rest('GET', `/api/agiles/${boardId}`, undefined, { fields: 'sprints(id,name)' });
  const hit = (board.sprints ?? []).find((s) => s.name === name);
  if (hit) return hit.id;
  const s = await rest('POST', `/api/agiles/${boardId}/sprints`, { name }, { fields: 'id,name' });
  return s.id;
}

async function createIssue(projectId, summary) {
  const i = await rest('POST', '/api/issues', { project: { id: projectId }, summary }, { fields: 'id,idReadable' });
  return i.id;
}

async function command(query, issueIds) {
  await rest('POST', '/api/commands', { query, issues: issueIds.map((id) => ({ id })) });
}

runMain().catch((e) => {
  console.error('SETUP FAILED:', e.message);
  process.exit(1);
});

async function runMain() {
  if (!TOKEN) throw new Error('No token: set YT_TEST_ADMIN_TOKEN or provide /tmp/yt25-token.txt');
  log('base', B);
  const projectId = await ensureProject('AppGlass', 'AG');
  log('project', projectId);

  const origId = await ensurePeriodField('Original Effort');
  const curId = await ensurePeriodField('Current Effort');
  await attachPeriodField(projectId, origId);
  await attachPeriodField(projectId, curId);
  log('effort fields attached');

  const stateFieldId = await findStateFieldId(projectId);
  const board = await ensureBoard(projectId, 'AppGlass Board', stateFieldId);
  log('board', board.id);
  const sprintId = await ensureSprint(board.id, 'AppGlass 2026-S2');
  log('sprint', sprintId);

  // Issues on the sprint with states + effort.
  const specs = [
    { s: 'Ship first customer preview', state: 'Fixed', orig: '1w', cur: '0h' },
    { s: 'Wire up capacity table', state: 'In Progress', orig: '3d', cur: '1d 4h' },
    { s: 'Auto-recalc metrics', state: 'In Progress', orig: '2d', cur: '1d' },
    { s: 'Carry-over on create-next', state: 'Open', orig: '1d', cur: '1d' },
    { s: 'Per-person load bar', state: 'Open', orig: '4h', cur: '4h' },
  ];
  const ids = [];
  for (const sp of specs) {
    const id = await createIssue(projectId, sp.s);
    ids.push({ id, sp });
  }
  await command(`Board AppGlass Board AppGlass 2026-S2`, ids.map((x) => x.id));
  for (const { id, sp } of ids) {
    await command(`State ${sp.state}`, [id]).catch(() => {});
    await command(`Original Effort ${sp.orig} Current Effort ${sp.cur}`, [id]).catch(() => {});
  }
  log('issues seeded', ids.length);

  // Configure the app: token for backend REST + project config.
  const cfgToken = await app('POST', '/__configure', { token: TOKEN, baseUrl: B });
  log('token configure', cfgToken.status);

  const me = await rest('GET', '/api/users/me', undefined, { fields: 'id' });
  const config = {
    version: 1,
    boardId: board.id,
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    firstSprintStart: '2026-06-22',
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    bootstrapFocusFactor: 0.75,
    learningRate: 0.2,
    maxFactorStep: 0.03,
    minFocusFactor: 0.55,
    maxFocusFactor: 0.9,
    participants: [{ userId: me.id, enabled: true }],
    managersGroup: 'AppGlass Team',
  };
  const put = await app('PUT', `/config?projectId=${projectId}`, { expectedRevision: 0, config });
  log('PUT /config', put.status, JSON.stringify(put.body).slice(0, 160));

  const check = await app('GET', `/config?projectId=${projectId}`);
  console.log(JSON.stringify({ projectId, boardId: board.id, sprintId, configStatus: check.status, configured: check.body?.configured }));
}
