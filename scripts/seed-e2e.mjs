/**
 * seed-e2e — deterministic fixtures for the Playwright e2e suite on a REAL YouTrack.
 *
 * Seeds TWO app-configured projects (the per-project-independence assertions need a
 * pair) plus the e2e personas. Config model v4: EVERY team owns its whole
 * configuration — board, cadence, naming, backlog, effort fields.
 *   - "Capacity One" (SCPE1): TWO fully separated teams —
 *       Alpha (admin + alice): its own board, 14-day sprints, 8h days,
 *         template "Alpha S{sequence}", backlog = Normal-priority Open issues;
 *       Beta (bob at 50%): a DIFFERENT board, 7-day sprints, 8h days,
 *         template "Beta S{sequence}", backlog = Major-priority Open issues.
 *   - "Capacity Two" (SCPE2): ONE team (admin + bob) — the single-team baseline and
 *     the independence counterpart. 7-day sprints, 6h days, its own template/board.
 *   - users alice/bob (password Passw0rd!) — non-manager members; admin is the
 *     project leader (= manager) of both projects.
 *
 * Writes artifacts/e2e-env.json for the Playwright fixtures and prints it.
 * Reseeding is safe; project team membership is granted via Hub REST inside
 * seedProject, so no UI automation is needed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { command, createIssue, ensureUser, grantProjectRole, makeClient, seedProject } from './lib/seed-lib.mjs';

const log = (...a) => console.log('[seed-e2e]', ...a);

runMain().catch((e) => { console.error('E2E SEED FAILED:', e.message); process.exit(1); });

async function runMain() {
  const c = makeClient();
  log('base', c.base);
  await ensureUser(c, 'alice', 'Alice Smith');
  await ensureUser(c, 'bob', 'Bob Jones');
  // eve is deliberately a member of NO project — the "no project role" persona.
  await ensureUser(c, 'eve', 'Eve Nguyen');
  log('personas ready (alice, bob, eve)');

  const teamDefaults = {
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    datePolicy: 'continuous',
  };

  const one = await seedProject(c, {
    name: 'Capacity One',
    key: 'SCPE1',
    projectMembers: ['alice', 'bob'],
    teams: [
      {
        id: 'team-1',
        boardName: 'Capacity One Alpha Board',
        sprintName: 'Alpha S1',
        sprintLengthDays: 14,
        sprintIssues: [
          { s: 'Alpha work A', state: 'In Progress', orig: '2d', cur: '1d', who: 'alice' },
          { s: 'Alpha work B', state: 'Open', orig: '3d', cur: '3d', who: 'admin' },
          { s: 'Alpha unassigned work', state: 'Open', orig: '4d', cur: '4d', who: null },
          // Assigned to bob (a NON-member of Alpha) — feeds the "assigned outside
          // this team" strip on Alpha's board.
          { s: 'Cross-team help', state: 'Open', orig: '1d', cur: '1d', who: 'bob' },
        ],
      },
      {
        id: 'team-2',
        boardName: 'Capacity One Beta Board',
        sprintName: 'Beta S1',
        sprintLengthDays: 7,
        sprintIssues: [
          { s: 'Beta work A', state: 'Open', orig: '2d', cur: '2d', who: 'bob' },
        ],
      },
    ],
    config: ({ boardIds }) => ({
      version: 4,
      teams: [
        {
          id: 'team-1',
          name: 'Alpha',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'alice', enabled: true, allocation: 1 },
          ],
          ...teamDefaults,
          boardId: boardIds['team-1'],
          hoursPerDay: 8,
          sprintLengthDays: 14,
          nameTemplate: 'Alpha S{sequence}',
          backlogQuery: 'project: SCPE1 State: Open Priority: Normal',
          learningRate: 0.3,
        },
        {
          id: 'team-2',
          name: 'Beta',
          participants: [{ userId: 'bob', enabled: true, allocation: 0.5 }],
          ...teamDefaults,
          boardId: boardIds['team-2'],
          hoursPerDay: 8,
          sprintLengthDays: 7,
          nameTemplate: 'Beta S{sequence}',
          backlogQuery: 'project: SCPE1 State: Open Priority: Major',
          learningRate: 0.5,
        },
      ],
    }),
    backlogIssues: [
      { s: 'Backlog item one', orig: '2d', cur: '2d' },
      { s: 'Backlog item two', orig: '3d', cur: '3d' },
      { s: 'Backlog item three', orig: '1d', cur: '1d' },
    ],
  }, log);

  // Beta's backlog is the Major-priority pool — seed one item for it.
  const betaBacklogId = await createIssue(c, one.projectId, 'Beta backlog item');
  await command(c, 'Original Effort 1d Current Effort 1d Priority Major State Open', [betaBacklogId]).catch(() => {});
  log('SCPE1: Beta backlog item seeded (Major priority)');

  const two = await seedProject(c, {
    name: 'Capacity Two',
    key: 'SCPE2',
    projectMembers: ['bob'],
    teams: [
      {
        id: 'team-1',
        boardName: 'Capacity Two Board',
        sprintName: 'Two S1',
        sprintLengthDays: 7,
        sprintIssues: [
          { s: 'Two work A', state: 'Open', orig: '1d', cur: '1d', who: 'bob' },
          { s: 'Two unassigned', state: 'Open', orig: '2d', cur: '2d', who: null },
        ],
      },
    ],
    config: ({ boardIds }) => ({
      version: 4,
      teams: [
        {
          id: 'team-1',
          name: 'Team 1',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'bob', enabled: true, allocation: 1 },
          ],
          ...teamDefaults,
          boardId: boardIds['team-1'],
          hoursPerDay: 6,
          sprintLengthDays: 7,
          nameTemplate: 'Two S{sequence}',
          backlogQuery: 'project: SCPE2 State: Open',
          learningRate: 0.2,
        },
      ],
    }),
    backlogIssues: [{ s: 'Two backlog item', orig: '1d', cur: '1d' }],
  }, log);

  // bob is a NON-LEADER project admin of Capacity Two: the app's manager role is
  // exactly YouTrack's UPDATE_PROJECT permission, and the permissions spec pins that
  // a granted admin (not just the leader) gets the manager controls.
  await grantProjectRole(c, 'bob', 'Capacity Two', 'project-admin');
  log('bob granted project-admin on Capacity Two');

  const env = {
    baseUrl: c.base,
    projects: {
      one: { key: 'SCPE1', projectId: one.projectId, teams: one.teams },
      two: { key: 'SCPE2', projectId: two.projectId, teams: two.teams },
    },
    personas: {
      manager: { login: process.env.YT_TEST_MANAGER_LOGIN ?? 'admin' },
      alice: { login: 'alice', password: 'Passw0rd!' },
      bob: { login: 'bob', password: 'Passw0rd!' },
      eve: { login: 'eve', password: 'Passw0rd!' },
    },
  };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/e2e-env.json', JSON.stringify(env, null, 2));
  console.log(JSON.stringify(env, null, 2));
}
