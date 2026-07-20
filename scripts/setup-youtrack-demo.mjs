/**
 * setup-youtrack-demo — make a running YouTrack fully demo-ready for the app:
 *   1. team users (alice/bob/charlie) via Hub
 *   2. period effort fields (Original/Current Effort) + agile board with sprints
 *   3. configure the app (backend token + PUT /config with the team + managers group)
 *   4. create a MANAGED sprint via the app (create-next) with seeded capacity
 *   5. issues on that sprint with effort, assignees and states — so the capacity/effort
 *      views show real data
 *
 * Env: YT_TEST_BASE_URL (default http://localhost:8080); tokens from /tmp/yt25-token.txt
 * (app/YouTrack scope) and /tmp/yt25-hubtoken.txt (Hub scope, for creating users).
 * Prints a JSON summary. Safe to re-run (idempotent-ish); pair with a clean app install.
 */
import { readFileSync } from 'node:fs';

const B = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const readTok = (p, env) => process.env[env] ?? (() => { try { return readFileSync(p, 'utf8').trim(); } catch { return ''; } })();
const TOKEN = readTok('/tmp/yt25-token.txt', 'YT_TEST_ADMIN_TOKEN');
const HUB_TOKEN = readTok('/tmp/yt25-hubtoken.txt', 'YT_TEST_HUB_TOKEN') || TOKEN;
const APP = 'sprint-capacity-planner';
const TUNNEL = `${B}/api/extensionEndpoints/${APP}/backend/api`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const HUB_H = { Authorization: `Bearer ${HUB_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const log = (...a) => console.log('[setup]', ...a);

async function rest(method, path, body, query, headers = H) {
  const url = new URL(path.replace(/^\//, ''), B.replace(/\/?$/, '/'));
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  const json = text.length > 0 ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new Error(`REST ${method} ${path} -> ${res.status}: ${String(text).slice(0, 200)}`);
  return json;
}
async function app(method, path, body) {
  const res = await fetch(TUNNEL, { method: 'POST', headers: H, body: JSON.stringify({ method, path, body }) });
  return res.json();
}

async function resolveUserId(login) {
  const users = await rest('GET', '/api/users', undefined, { fields: 'id,login', query: login, $top: '20' });
  const hit = Array.isArray(users) ? users.find((u) => u.login === login) : null;
  return hit?.id ?? null;
}
async function ensureUser(login, name) {
  const existing = await resolveUserId(login);
  if (existing) return existing;
  await rest('POST', '/hub/api/rest/users', { name, login, password: 'Passw0rd!' }, { fields: 'id,login' }, HUB_H).catch(() => {});
  // Give Hub a moment to project into YouTrack, then resolve the YouTrack id.
  for (let i = 0; i < 10; i += 1) {
    const id = await resolveUserId(login);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPending = (p) => p.archived === true || /pending deletion/i.test(p.name ?? '');

/** Clean the demo IN PLACE: remove all sprints on the board + all issues in the project,
 *  so each run seeds a clean, collision-free demo without deleting (and stranding) the
 *  project/board. */
async function cleanSlate(projectId, boardId, shortName) {
  const board = await rest('GET', `/api/agiles/${boardId}`, undefined, { fields: 'sprints(id,name)' }).catch(() => null);
  for (const s of board?.sprints ?? []) {
    await rest('DELETE', `/api/agiles/${boardId}/sprints/${s.id}`).catch(() => {});
  }
  let issues = await rest('GET', '/api/issues', undefined, { query: `project: ${shortName}`, fields: 'id', $top: '200' }).catch(() => []);
  for (const i of Array.isArray(issues) ? issues : []) {
    await rest('DELETE', `/api/issues/${i.id}`).catch(() => {});
  }
}

/** Reuse a live (non-pending-deletion) AG project, waiting out any pending one, else create. */
async function ensureProject(name, shortName) {
  for (let i = 0; i < 40; i += 1) {
    const existing = await rest('GET', '/api/admin/projects', undefined, { fields: 'id,shortName,name,archived', $top: '200' });
    const matches = (Array.isArray(existing) ? existing : []).filter((p) => p.shortName === shortName);
    const live = matches.find((p) => !isPending(p));
    if (live) return live.id;
    if (matches.length === 0) {
      const me = await rest('GET', '/api/users/me', undefined, { fields: 'id' });
      const p = await rest('POST', '/api/admin/projects', { name, shortName, leader: { id: me.id } }, { fields: 'id' }).catch(() => null);
      if (p?.id) return p.id;
    }
    await sleep(1500); // a pending-deletion project holds the short name; wait it out
  }
  throw new Error(`could not obtain a live project with shortName ${shortName}`);
}
async function ensurePeriodField(name) {
  const fields = await rest('GET', '/api/admin/customFieldSettings/customFields', undefined, { fields: 'id,name', $top: '300' });
  const hit = Array.isArray(fields) ? fields.find((f) => f.name === name) : null;
  if (hit) return hit.id;
  const created = await rest('POST', '/api/admin/customFieldSettings/customFields', { name, fieldType: { id: 'period', $type: 'FieldType' }, $type: 'CustomField' }, { fields: 'id' });
  return created.id;
}
async function attachField(projectId, fieldId) {
  const attached = await rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, { fields: 'field(id)', $top: '100' });
  if (Array.isArray(attached) && attached.some((f) => f.field?.id === fieldId)) return;
  await rest('POST', `/api/admin/projects/${projectId}/customFields`, { field: { id: fieldId }, $type: 'PeriodProjectCustomField', canBeEmpty: true, emptyFieldText: '—' }, { fields: 'id' });
}
async function findStateFieldId(projectId) {
  const fields = await rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, { fields: 'field(id,name)', $top: '100' });
  return fields.find((f) => f.field?.name === 'State')?.field?.id ?? null;
}
async function ensureBoard(projectId, name, stateFieldId) {
  // Board deletion is instant (unlike project deletion), so always recreate a fresh board
  // for this project — avoids reusing a board stranded on a pending-deletion project.
  const boards = await rest('GET', '/api/agiles', undefined, { fields: 'id,name', $top: '100' }).catch(() => []);
  for (const b of Array.isArray(boards) ? boards : []) {
    if (b.name === name) await rest('DELETE', `/api/agiles/${b.id}`).catch(() => {});
  }
  const b = await rest('POST', '/api/agiles', { name, projects: [{ id: projectId }], columnSettings: { field: { id: stateFieldId } }, sprintsSettings: { disableSprints: false, cardOnSeveralSprints: false } }, { fields: 'id' });
  return b.id;
}
async function createIssue(projectId, summary) {
  const i = await rest('POST', '/api/issues', { project: { id: projectId }, summary }, { fields: 'id,idReadable' });
  return i.id;
}
async function command(query, issueIds, extra) {
  await rest('POST', '/api/commands', { query, issues: issueIds.map((id) => ({ id })), ...(extra ?? {}) });
}

runMain().catch((e) => { console.error('SETUP FAILED:', e.message); process.exit(1); });

async function runMain() {
  if (!TOKEN) throw new Error('No app token');
  log('base', B);
  const me = await rest('GET', '/api/users/me', undefined, { fields: 'id' });
  // A fuller team so the planning board has several lanes, including part-timers.
  const alice = await ensureUser('alice', 'Alice Smith');
  const bob = await ensureUser('bob', 'Bob Jones');
  const charlie = await ensureUser('charlie', 'Charlie Diaz');
  const dana = await ensureUser('dana', 'Dana Lee');
  const erin = await ensureUser('erin', 'Erin Park');
  log('team', { me: me.id, alice, bob, charlie, dana, erin });

  const projectId = await ensureProject('AppGlass', 'AGP');
  const origId = await ensurePeriodField('Original Effort');
  const curId = await ensurePeriodField('Current Effort');
  await attachField(projectId, origId);
  await attachField(projectId, curId);
  const stateFieldId = await findStateFieldId(projectId);
  const boardId = await ensureBoard(projectId, 'AppGlass Board', stateFieldId);
  log('project/board', projectId, boardId);
  await cleanSlate(projectId, boardId, 'AGP');
  log('clean slate (sprints + issues cleared)');

  // Configure the app (token + config with the team + managers group). Allocations show off
  // part-time capacity: Bob is 50%, Dana 80%; the rest full-time. Erin is deliberately left
  // OFF the team here (though she is a real, assignable project member) so the setup reel can
  // add her live with the picker — see tests/e2e/demo/01-setup.spec.ts.
  await app('POST', '/__configure', { token: TOKEN, baseUrl: B });
  const participants = [{ userId: me.id, enabled: true, allocation: 1 }];
  const partTime = { [alice]: 1, [bob]: 0.5, [charlie]: 1, [dana]: 0.8 };
  for (const u of [alice, bob, charlie, dana]) {
    if (u) participants.push({ userId: u, enabled: true, allocation: partTime[u] ?? 1 });
  }
  const config = {
    version: 1, boardId, originalEffortField: 'Original Effort', currentEffortField: 'Current Effort',
    hoursPerDay: 8, sprintLengthDays: 14, datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    // Backlog = open issues in the project (those already in the Sprint are excluded).
    backlogQuery: 'project: AGP State: Open',
    learningRate: 0.2, participants,
    managersGroup: 'AppGlass Team',
  };
  // Revision-aware so this is re-runnable (e.g. a second pass after adding the team).
  const currentCfg = await app('GET', `/config?projectId=${projectId}`);
  const expectedRevision = currentCfg.body?.configRevision ?? 0;
  const put = await app('PUT', `/config?projectId=${projectId}`, { expectedRevision, config });
  log('PUT /config', put.status);

  // Create a MANAGED sprint via the app (seeds capacity for all participants).
  const created = await app('POST', `/sprints/create-next?projectId=${projectId}`, { moveUnresolvedIssues: false });
  if (created.status !== 200) throw new Error(`create-next ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
  const sprint = created.body;
  log('managed sprint', sprint.id, sprint.name, sprint.start, '->', sprint.finish);

  // Seed issues onto the managed sprint with effort, assignee and state.
  // Only project members are assignable; admin is the reliable one on a fresh instance.
  // Some issues go to admin (shows per-person Load), others stay unassigned (shows the
  // Unassigned bucket). MEMBERS teammates get assigned too if they're on the project team.
  const assignable = new Set(['admin']);
  // A realistic, deliberately over-committed Sprint: every assigned teammate individually
  // fits (Erin is nudged just over her part-time capacity), but a chunk of high-effort work
  // is left UNASSIGNED in the backlog, pushing the whole Sprint over planned capacity — the
  // exact case the planning board highlights.
  const specs = [
    { s: 'Checkout API v2', state: 'In Progress', orig: '3d', cur: '2d', who: 'admin' },
    { s: 'Payment retries & idempotency', state: 'Open', orig: '3d', cur: '3d', who: 'admin' },
    { s: 'Capacity table polish', state: 'In Progress', orig: '4d', cur: '2d', who: 'alice' },
    { s: 'Sprint burndown widget', state: 'Open', orig: '3d', cur: '3d', who: 'alice' },
    { s: 'Part-time allocation UI', state: 'Open', orig: '2d', cur: '1d', who: 'bob' },
    { s: 'Board drag-and-drop', state: 'In Progress', orig: '5d', cur: '4d', who: 'charlie' },
    { s: 'Focus-factor calibration', state: 'Open', orig: '4d', cur: '4d', who: 'dana' },
    // Erin is not on the team in the prepared state (the setup reel adds her), so her work
    // stays unassigned in the Sprint — which also feeds the deliberate over-capacity story.
    { s: 'Docs & onboarding', state: 'Open', orig: '4d', cur: '4d', who: null },
    { s: 'Localization polish', state: 'Open', orig: '3d', cur: '3d', who: null },
    { s: 'Mobile responsive pass', state: 'Open', orig: '5d', cur: '5d', who: null },
    { s: 'Accessibility audit fixes', state: 'Open', orig: '4d', cur: '4d', who: null },
    { s: 'Perf: virtualize large boards', state: 'Open', orig: '3d', cur: '3d', who: null },
  ];
  for (const sp of specs) {
    const id = await createIssue(projectId, sp.s);
    await command(`Board AppGlass Board ${sprint.name}`, [id]).catch((e) => log('add-to-sprint warn', e.message.slice(0, 80)));
    await command(`Original Effort ${sp.orig} Current Effort ${sp.cur}`, [id]).catch((e) => log('effort warn', e.message.slice(0, 80)));
    await command(`State ${sp.state}`, [id]).catch(() => {});
    if (sp.who) {
      // Try the requested assignee; on failure (not a project member) fall back to admin.
      const ok = await command(`Assignee ${sp.who}`, [id]).then(() => true).catch(() => false);
      if (ok) assignable.add(sp.who);
      else await command('Assignee admin', [id]).catch(() => {});
    }
  }
  log('issues seeded', specs.length);

  // Backlog: Open issues in the project that are NOT added to the Sprint, so the planning
  // board's backlog lane has items to drag in. (Matched by config.backlogQuery.)
  const backlogSpecs = [
    { s: 'Search indexing revamp', orig: '3d', cur: '3d' },
    { s: 'CSV export for reports', orig: '2d', cur: '2d' },
    { s: 'Audit log for admin actions', orig: '4d', cur: '4d' },
    { s: 'SSO / SAML support', orig: '5d', cur: '5d' },
    { s: 'Dark mode', orig: '2d', cur: '2d' },
  ];
  for (const sp of backlogSpecs) {
    const id = await createIssue(projectId, sp.s);
    await command(`Original Effort ${sp.orig} Current Effort ${sp.cur}`, [id]).catch(() => {});
    await command('State Open', [id]).catch(() => {});
    // Deliberately NOT added to the Sprint — this is the backlog.
  }
  log('backlog issues seeded', backlogSpecs.length);

  const check = await app('GET', `/sprints/${sprint.id}?projectId=${projectId}`);
  const v = check.body ?? {};
  console.log(JSON.stringify({
    projectId, boardId, sprintId: sprint.id, sprintName: sprint.name,
    configured: true, rows: Object.keys(v.capacity?.rows ?? {}).length,
    rawCapacityMinutes: v.rawCapacityMinutes, originalEffortMinutes: v.originalEffortMinutes,
    currentEffortMinutes: v.currentEffortMinutes,
  }, null, 2));
}
