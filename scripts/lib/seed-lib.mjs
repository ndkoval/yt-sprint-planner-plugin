/**
 * seed-lib — shared building blocks for seeding a REAL YouTrack with app data:
 * users (Hub), projects, period effort fields, sprint-enabled agile boards, issues,
 * and the app's own v3 config / managed-sprint state through the CURRENT backend API
 * (`/api/extensionEndpoints/<app>/backend/<endpoint>?project=<KEY>`, {ok,...} envelope).
 *
 * Used by scripts/setup-youtrack-demo.mjs (demo data) and scripts/seed-e2e.mjs
 * (deterministic e2e fixtures). Everything is idempotent-ish and safe to re-run.
 */
import { readFileSync } from 'node:fs';

export const APP_NAME = 'sprint-capacity-planner';

const readTok = (p, env) =>
  process.env[env] ?? (() => { try { return readFileSync(p, 'utf8').trim(); } catch { return ''; } })();

/** Environment + authenticated fetch helpers bound to one YouTrack instance. */
export function makeClient() {
  const base = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
  const token = readTok('/tmp/yt25-token.txt', 'YT_TEST_ADMIN_TOKEN');
  const hubToken = readTok('/tmp/yt25-hubtoken.txt', 'YT_TEST_HUB_TOKEN') || token;
  if (!token) throw new Error('No admin token (YT_TEST_ADMIN_TOKEN or /tmp/yt25-token.txt)');
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  const HUB_H = { Authorization: `Bearer ${hubToken}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  async function rest(method, path, body, query, headers = H) {
    const url = new URL(path.replace(/^\//, ''), base.replace(/\/?$/, '/'));
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    const json = text.length > 0 ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) throw new Error(`REST ${method} ${path} -> ${res.status}: ${String(text).slice(0, 200)}`);
    return json;
  }

  /** Call a backend app endpoint for a project (admin token = admin caller). */
  async function app(method, endpoint, projectKey, body) {
    const url = new URL(`api/extensionEndpoints/${APP_NAME}/backend/${endpoint}`, base.replace(/\/?$/, '/'));
    url.searchParams.set('project', projectKey);
    const res = await fetch(url, {
      method,
      headers: H,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let envelope;
    try { envelope = JSON.parse(text); } catch { envelope = null; }
    if (!res.ok || envelope === null || typeof envelope !== 'object' || !('ok' in envelope)) {
      throw new Error(`app ${method} ${endpoint}?project=${projectKey} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!envelope.ok) {
      throw new Error(`app ${method} ${endpoint}?project=${projectKey} -> ${envelope.error?.code}: ${envelope.error?.message}`);
    }
    return envelope.data;
  }

  return { base, token, hubToken, H, HUB_H, rest, app };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPending = (p) => p.archived === true || /pending deletion/i.test(p.name ?? '');

export async function resolveUserId(c, login) {
  const users = await c.rest('GET', '/api/users', undefined, { fields: 'id,login', query: login, $top: '20' });
  const hit = Array.isArray(users) ? users.find((u) => u.login === login) : null;
  return hit?.id ?? null;
}

/** Hub's core (login/password) auth module id, cached on the client. */
async function coreAuthModuleId(c) {
  if (c._coreAuthModuleId) return c._coreAuthModuleId;
  const mods = await c
    .rest('GET', '/hub/api/rest/authmodules', undefined, { fields: 'id,name,type' }, c.HUB_H)
    .catch(() => null);
  const list = mods?.authmodules ?? [];
  const core = list.find((m) => m.type === 'CoreauthmoduleJSON') ?? list.find((m) => m.name === 'Hub');
  c._coreAuthModuleId = core?.id ?? null;
  return c._coreAuthModuleId;
}

/**
 * Make sure a Hub user can actually LOG IN with login/password. Creating a user via
 * `POST /hub/api/rest/users {password}` does NOT attach credentials — a loginable user
 * needs a `LoginuserdetailsJSON` detail bound to the core auth module (verified on
 * 2025.3: users without it get `hub-auth-credentials-bad`). Idempotent.
 */
export async function ensureUserCredentials(c, login, password) {
  const page = await c
    .rest('GET', '/hub/api/rest/users', undefined, { fields: 'id,login,details(type)', query: login }, c.HUB_H)
    .catch(() => null);
  const hubUser = page?.users?.find((u) => u.login === login);
  if (!hubUser) return false;
  const hasLogin = (hubUser.details ?? []).some((d) => d.type === 'LoginuserdetailsJSON');
  if (hasLogin) return true;
  const moduleId = await coreAuthModuleId(c);
  if (!moduleId) return false;
  await c.rest(
    'POST',
    `/hub/api/rest/users/${hubUser.id}`,
    {
      details: [
        {
          type: 'LoginuserdetailsJSON',
          authModule: { id: moduleId },
          login,
          password: { type: 'PlainpasswordJSON', value: password },
        },
      ],
    },
    { fields: 'id' },
    c.HUB_H,
  );
  return true;
}

export async function ensureUser(c, login, name, password = 'Passw0rd!') {
  let id = await resolveUserId(c, login);
  if (!id) {
    await c.rest('POST', '/hub/api/rest/users', { name, login }, { fields: 'id,login' }, c.HUB_H).catch(() => {});
    // Give Hub a moment to project into YouTrack, then resolve the YouTrack id.
    for (let i = 0; i < 10; i += 1) {
      id = await resolveUserId(c, login);
      if (id) break;
      await sleep(500);
    }
  }
  // Existing users may predate credential seeding — always repair login/password.
  await ensureUserCredentials(c, login, password);
  return id;
}

/** Set a user's Hub display name (by Hub/ring id) and wait (best-effort) for the sync. */
export async function renameUser(c, ringId, name) {
  if (!ringId) return;
  await c.rest('POST', `/hub/api/rest/users/${ringId}`, { name }, { fields: 'id,name' }, c.HUB_H).catch(() => {});
  for (let i = 0; i < 60; i += 1) {
    const u = await c.rest('GET', '/api/users/me', undefined, { fields: 'fullName' }).catch(() => null);
    if (u?.fullName === name) return;
    await sleep(1000);
  }
}

/**
 * Add users (by login) to a project's TEAM via Hub REST, so they become assignable
 * project members with the Contributor role. (The YouTrack REST API doesn't expose
 * team membership, but Hub's projectteams resource does — verified on 2025.3.)
 */
export async function addProjectTeamMembers(c, projectName, logins) {
  const page = await c.rest(
    'GET',
    '/hub/api/rest/projects',
    undefined,
    { query: projectName, fields: 'id,name,team(id,name)' },
    c.HUB_H,
  );
  const project = page?.projects?.find((p) => p.name === projectName);
  const teamId = project?.team?.id;
  if (!teamId) throw new Error(`Hub project team not found for "${projectName}"`);
  const added = [];
  for (const login of logins) {
    const users = await c.rest(
      'GET',
      '/hub/api/rest/users',
      undefined,
      { query: login, fields: 'id,login' },
      c.HUB_H,
    );
    const hubUser = users?.users?.find((u) => u.login === login);
    if (!hubUser) continue;
    await c
      .rest('POST', `/hub/api/rest/projectteams/${teamId}/users`, { id: hubUser.id }, { fields: 'id' }, c.HUB_H)
      .catch(() => {}); // already a member
    added.push(login);
  }
  return added;
}

/**
 * Grant a user a Hub role (e.g. 'project-admin') on a project. The app's "manager"
 * is whoever holds UPDATE_PROJECT on the project — granting project-admin is how a
 * non-leader becomes a planning manager. Idempotent (duplicate grants 409 → ignored).
 */
export async function grantProjectRole(c, login, projectName, roleKey = 'project-admin') {
  const users = await c.rest('GET', '/hub/api/rest/users', undefined, { query: login, fields: 'id,login' }, c.HUB_H);
  const hubUser = users?.users?.find((u) => u.login === login);
  if (!hubUser) throw new Error(`Hub user not found: ${login}`);
  const page = await c.rest('GET', '/hub/api/rest/projects', undefined, { query: projectName, fields: 'id,name' }, c.HUB_H);
  const project = page?.projects?.find((p) => p.name === projectName);
  if (!project) throw new Error(`Hub project not found: ${projectName}`);
  await c
    .rest(
      'POST',
      `/hub/api/rest/users/${hubUser.id}/projectroles`,
      { role: { key: roleKey }, project: { id: project.id } },
      { fields: 'id' },
      c.HUB_H,
    )
    .catch(() => {}); // already granted
}

/** Reuse a live (non-pending-deletion) project, waiting out any pending one, else create. */
export async function ensureProject(c, name, shortName) {
  for (let i = 0; i < 40; i += 1) {
    const existing = await c.rest('GET', '/api/admin/projects', undefined, { fields: 'id,shortName,name,archived', $top: '200' });
    const matches = (Array.isArray(existing) ? existing : []).filter((p) => p.shortName === shortName);
    const live = matches.find((p) => !isPending(p));
    if (live) return live.id;
    if (matches.length === 0) {
      const me = await c.rest('GET', '/api/users/me', undefined, { fields: 'id' });
      const p = await c.rest('POST', '/api/admin/projects', { name, shortName, leader: { id: me.id } }, { fields: 'id' }).catch(() => null);
      if (p?.id) return p.id;
    }
    await sleep(1500); // a pending-deletion project holds the short name; wait it out
  }
  throw new Error(`could not obtain a live project with shortName ${shortName}`);
}

export async function ensurePeriodField(c, name) {
  const fields = await c.rest('GET', '/api/admin/customFieldSettings/customFields', undefined, { fields: 'id,name', $top: '300' });
  const hit = Array.isArray(fields) ? fields.find((f) => f.name === name) : null;
  if (hit) return hit.id;
  const created = await c.rest('POST', '/api/admin/customFieldSettings/customFields', { name, fieldType: { id: 'period', $type: 'FieldType' }, $type: 'CustomField' }, { fields: 'id' });
  return created.id;
}

export async function attachField(c, projectId, fieldId) {
  const attached = await c.rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, { fields: 'field(id)', $top: '100' });
  if (Array.isArray(attached) && attached.some((f) => f.field?.id === fieldId)) return;
  await c.rest('POST', `/api/admin/projects/${projectId}/customFields`, { field: { id: fieldId }, $type: 'PeriodProjectCustomField', canBeEmpty: true, emptyFieldText: '—' }, { fields: 'id' });
}

/**
 * Ensure a single-enum custom field exists, is attached to the project, and its
 * bundle contains the given values (for teams mirroring Sprints into a field).
 * Values accumulate in one shared bundle per field name — fine for seeds.
 */
export async function ensureEnumField(c, projectId, name, values = []) {
  const fields = await c.rest('GET', '/api/admin/customFieldSettings/customFields', undefined, { fields: 'id,name', $top: '300' });
  let fieldId = Array.isArray(fields) ? fields.find((f) => f.name === name)?.id : null;
  if (!fieldId) {
    const created = await c.rest('POST', '/api/admin/customFieldSettings/customFields', { name, fieldType: { id: 'enum[1]', $type: 'FieldType' }, $type: 'CustomField' }, { fields: 'id' });
    fieldId = created.id;
  }
  // Attach with a bundle (create one per field name when first attached anywhere).
  const attached = await c.rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, { fields: 'field(id,name),bundle(id)', $top: '100' });
  let bundleId = Array.isArray(attached) ? attached.find((f) => f.field?.id === fieldId)?.bundle?.id : null;
  if (!bundleId) {
    const bundles = await c.rest('GET', '/api/admin/customFieldSettings/bundles/enum', undefined, { fields: 'id,name', $top: '300' }).catch(() => []);
    bundleId = Array.isArray(bundles) ? bundles.find((b) => b.name === `${name} values`)?.id : null;
    if (!bundleId) {
      const bundle = await c.rest('POST', '/api/admin/customFieldSettings/bundles/enum', { name: `${name} values`, $type: 'EnumBundle' }, { fields: 'id' });
      bundleId = bundle.id;
    }
    await c.rest('POST', `/api/admin/projects/${projectId}/customFields`, {
      field: { id: fieldId },
      bundle: { id: bundleId, $type: 'EnumBundle' },
      $type: 'EnumProjectCustomField',
      canBeEmpty: true,
      emptyFieldText: 'No sprint',
    }, { fields: 'id' });
  }
  const existing = await c.rest('GET', `/api/admin/customFieldSettings/bundles/enum/${bundleId}/values`, undefined, { fields: 'id,name', $top: '500' }).catch(() => []);
  for (const v of values) {
    if (Array.isArray(existing) && existing.some((e) => e.name === v)) continue;
    await c.rest('POST', `/api/admin/customFieldSettings/bundles/enum/${bundleId}/values`, { name: v }, { fields: 'id' }).catch(() => {});
  }
  return { fieldId, bundleId };
}

export async function findStateFieldId(c, projectId) {
  const fields = await c.rest('GET', `/api/admin/projects/${projectId}/customFields`, undefined, { fields: 'field(id,name)', $top: '100' });
  return fields.find((f) => f.field?.name === 'State')?.field?.id ?? null;
}

/** Always recreate the named board for this project (board deletion is instant). */
export async function ensureBoard(c, projectId, name, stateFieldId) {
  const boards = await c.rest('GET', '/api/agiles', undefined, { fields: 'id,name', $top: '100' }).catch(() => []);
  for (const b of Array.isArray(boards) ? boards : []) {
    if (b.name === name) await c.rest('DELETE', `/api/agiles/${b.id}`).catch(() => {});
  }
  // projectBased sharing: board visibility follows project access — REST-created
  // boards otherwise default to OWNER-ONLY, which 403s every member's sprint read.
  const b = await c.rest('POST', '/api/agiles', {
    name,
    projects: [{ id: projectId }],
    columnSettings: { field: { id: stateFieldId } },
    sprintsSettings: { disableSprints: false, cardOnSeveralSprints: false },
    readSharingSettings: { projectBased: true },
    updateSharingSettings: { projectBased: true },
  }, { fields: 'id' });
  return b.id;
}

/** Remove all sprints on one board (fresh demo/e2e state). */
export async function cleanSlateBoard(c, boardId) {
  const board = await c.rest('GET', `/api/agiles/${boardId}`, undefined, { fields: 'sprints(id,name)' }).catch(() => null);
  for (const s of board?.sprints ?? []) {
    await c.rest('DELETE', `/api/agiles/${boardId}/sprints/${s.id}`).catch(() => {});
  }
}

/** Remove all issues in a project. */
export async function deleteProjectIssues(c, shortName) {
  const issues = await c.rest('GET', '/api/issues', undefined, { query: `project: ${shortName}`, fields: 'id', $top: '400' }).catch(() => []);
  for (const i of Array.isArray(issues) ? issues : []) {
    await c.rest('DELETE', `/api/issues/${i.id}`).catch(() => {});
  }
}

/** Remove all sprints on a board + all issues in a project (fresh demo/e2e state). */
export async function cleanSlate(c, projectId, boardId, shortName) {
  await cleanSlateBoard(c, boardId);
  await deleteProjectIssues(c, shortName);
}

export async function createIssue(c, projectId, summary) {
  const i = await c.rest('POST', '/api/issues', { project: { id: projectId }, summary }, { fields: 'id,idReadable' });
  return i.id;
}

export async function command(c, query, issueIds, extra) {
  await c.rest('POST', '/api/commands', { query, issues: issueIds.map((id) => ({ id })), ...(extra ?? {}) });
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Save the app's project config (revision-aware, so re-runs don't conflict).
 * `config` must be a complete v4 ProjectConfig ({version: 4, teams: [...]}) where
 * every team carries its FULL settings (board, effort fields, cadence, backlog...).
 */
export async function putAppConfig(c, projectKey, config) {
  const current = await c.app('GET', 'config', projectKey);
  const expectedRevision = current.configRevision ?? 0;
  return c.app('POST', 'config', projectKey, { expectedRevision, config });
}

/**
 * Create a native Sprint on the TEAM's board (REST, dates as epoch-ms) and register
 * it with the app for that team (seeds the team's sequence + capacity). Mirrors the
 * widget's create-next flow. startOffsetDays lets callers seed past sprints
 * (negative offsets) for history. `teamId` may be omitted for single-team projects.
 */
export async function createManagedSprint(c, projectKey, boardId, name, lengthDays, startOffsetDays = 0, teamId = undefined) {
  const DAY = 24 * 60 * 60 * 1000;
  const todayUtc = Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
  );
  const startMs = todayUtc + startOffsetDays * DAY;
  const finishMs = startMs + (lengthDays - 1) * DAY;
  const s = await c.rest('POST', `/api/agiles/${boardId}/sprints`, { name, start: startMs, finish: finishMs }, { fields: 'id,name' });
  const registered = await c.app('POST', 'sprint-register', projectKey, {
    ...(teamId !== undefined ? { teamId } : {}),
    sprint: { id: s.id, name, start: isoDay(startMs), finish: isoDay(finishMs) },
  });
  return { id: s.id, name, start: isoDay(startMs), finish: isoDay(finishMs), entry: registered.entry };
}

/**
 * Seed issues into a sprint (via the board command) with effort/state/assignee.
 * spec: {s, state, orig, cur, who|null}. Falls back to admin when the requested
 * assignee is not an assignable project member. `enumFields` ([{name, value}])
 * are set via REST on every created issue — used to pre-fill a team's Sprint
 * MIRROR field to the seeded sprint's name, as if planned through the app.
 */
export async function seedSprintIssues(c, projectId, boardName, sprintName, specs, enumFields = []) {
  for (const sp of specs) {
    const id = await createIssue(c, projectId, sp.s);
    await command(c, `Board ${boardName} ${sprintName}`, [id]).catch(() => {});
    await command(c, `Original Effort ${sp.orig} Current Effort ${sp.cur}`, [id]).catch(() => {});
    if (sp.state) await command(c, `State ${sp.state}`, [id]).catch(() => {});
    if (sp.who) {
      const ok = await command(c, `Assignee ${sp.who}`, [id]).then(() => true).catch(() => false);
      if (!ok) await command(c, 'Assignee admin', [id]).catch(() => {});
    }
    for (const ef of enumFields) {
      await c.rest('POST', `/api/issues/${id}`, {
        customFields: [{ name: ef.name, $type: 'SingleEnumIssueCustomField', value: { name: ef.value } }],
      }, { fields: 'id' }).catch(() => {});
    }
  }
}

/** Seed plain backlog issues (Open, NOT in any sprint). spec: {s, orig, cur}. */
export async function seedBacklogIssues(c, projectId, specs) {
  for (const sp of specs) {
    const id = await createIssue(c, projectId, sp.s);
    await command(c, `Original Effort ${sp.orig} Current Effort ${sp.cur}`, [id]).catch(() => {});
    await command(c, 'State Open', [id]).catch(() => {});
  }
}

/**
 * Provision one fully working project for the app (config v4 — every team fully
 * separated): project + team members + effort fields + a fresh board PER TEAM +
 * clean slate + v4 app config + one managed sprint per team + per-team sprint
 * issues + project backlog issues. Returns per-team ids for follow-up steps.
 *
 * spec: {
 *   name, key, projectMembers: [logins],
 *   teams: [{ id, boardName, sprintName, sprintLengthDays, startOffsetDays?,
 *             sprintIssues: [{s,state,orig,cur,who|null}] }],
 *   config: ({ projectId, boardIds }) => ProjectConfigV4   // boardIds keyed by team id
 *   backlogIssues: [...],
 * }
 */
export async function seedProject(c, spec, log = () => {}) {
  const projectId = await ensureProject(c, spec.name, spec.key);
  if (spec.projectMembers?.length) {
    const added = await addProjectTeamMembers(c, spec.name, spec.projectMembers);
    log(`${spec.key}: project team members ${added.join(', ') || '(none added)'}`);
  }
  const origId = await ensurePeriodField(c, 'Original Effort');
  const curId = await ensurePeriodField(c, 'Current Effort');
  await attachField(c, projectId, origId);
  await attachField(c, projectId, curId);
  const stateFieldId = await findStateFieldId(c, projectId);

  // One board per team (teams may plan on different boards with different cadences).
  const boardIds = {};
  for (const team of spec.teams) {
    boardIds[team.id] = await ensureBoard(c, projectId, team.boardName, stateFieldId);
    await cleanSlateBoard(c, boardIds[team.id]);
  }
  await deleteProjectIssues(c, spec.key);
  log(`${spec.key}: project ${projectId}, boards ${Object.values(boardIds).join(', ')}`);

  // Wipe the app's accumulated Sprint state (wholesale replace with an empty v4
  // bundle). Without this, reseeding on a live install keeps old per-team entries
  // and Sprint SEQUENCES keep growing across reseeds — the "fixed prepared data"
  // guarantee (and every "…-S2 comes next" assertion) silently breaks.
  await c.app('POST', 'import', spec.key, {
    bundle: { exportedAt: Date.now(), configRevision: 0, teams: {} },
    dryRun: false,
  }).catch(() => {});

  const config = spec.config({ projectId, boardIds });

  // Teams mirroring Sprints into an enum field need the field attached and the
  // seeded sprint's name present as a bundle value.
  for (const teamCfg of config.teams) {
    const fieldName = (teamCfg.sprintFieldName ?? '').trim();
    if (!fieldName) continue;
    const teamSpec = spec.teams.find((t) => t.id === teamCfg.id);
    await ensureEnumField(c, projectId, fieldName, teamSpec?.sprintName ? [teamSpec.sprintName] : []);
    log(`${spec.key}/${teamCfg.id}: enum sprint field "${fieldName}" ready`);
  }

  await putAppConfig(c, spec.key, config);
  log(`${spec.key}: app config saved (${config.teams.length} team(s))`);

  const teams = [];
  for (const team of spec.teams) {
    const teamCfg = config.teams.find((t) => t.id === team.id);
    const sprint = await createManagedSprint(
      c, spec.key, boardIds[team.id], team.sprintName,
      team.sprintLengthDays ?? teamCfg?.sprintLengthDays ?? 14,
      team.startOffsetDays ?? 0, team.id,
    );
    log(`${spec.key}/${team.id}: managed sprint ${sprint.id} ${sprint.name} ${sprint.start} -> ${sprint.finish}`);
    const mirrorField = (teamCfg?.sprintFieldName ?? '').trim();
    await seedSprintIssues(
      c, projectId, team.boardName, team.sprintName, team.sprintIssues ?? [],
      mirrorField ? [{ name: mirrorField, value: team.sprintName }] : [],
    );
    teams.push({
      teamId: team.id,
      name: teamCfg?.name ?? team.id,
      boardId: boardIds[team.id],
      sprintId: sprint.id,
      sprintName: sprint.name,
    });
  }

  await seedBacklogIssues(c, projectId, spec.backlogIssues ?? []);
  log(`${spec.key}: ${spec.teams.reduce((n, t) => n + (t.sprintIssues?.length ?? 0), 0)} sprint + ${spec.backlogIssues?.length ?? 0} backlog issues`);

  return { projectId, teams };
}
