/**
 * seed-e2e — deterministic fixtures for the Playwright e2e suite on a REAL YouTrack.
 *
 * Seeds TWO app-configured projects (the per-project-independence assertions need a
 * pair) plus the e2e personas:
 *   - "Capacity One" (SCPE1): TWO teams — Alpha (admin + alice) and Beta (bob at 50%)
 *     — for the multi-team scenarios. 14-day sprints, 8h days.
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
import { ensureUser, grantProjectRole, makeClient, seedProject } from './lib/seed-lib.mjs';

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

  const one = await seedProject(c, {
    name: 'Capacity One',
    key: 'SCPE1',
    boardName: 'Capacity One Board',
    sprintName: 'One S1',
    projectMembers: ['alice', 'bob'],
    config: ({ boardId }) => ({
      version: 3,
      boardId,
      originalEffortField: 'Original Effort',
      currentEffortField: 'Current Effort',
      hoursPerDay: 8,
      sprintLengthDays: 14,
      datePolicy: 'continuous',
      nameTemplate: 'One S{sequence}',
      backlogQuery: 'project: SCPE1 State: Open',
      learningRate: 0.3,
      teams: [
        {
          id: 'team-1',
          name: 'Alpha',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'alice', enabled: true, allocation: 1 },
          ],
        },
        {
          id: 'team-2',
          name: 'Beta',
          participants: [{ userId: 'bob', enabled: true, allocation: 0.5 }],
        },
      ],
    }),
    sprintIssues: [
      { s: 'Alpha work A', state: 'In Progress', orig: '2d', cur: '1d', who: 'alice' },
      { s: 'Alpha work B', state: 'Open', orig: '3d', cur: '3d', who: 'admin' },
      { s: 'Beta work A', state: 'Open', orig: '2d', cur: '2d', who: 'bob' },
      { s: 'Shared unassigned work', state: 'Open', orig: '4d', cur: '4d', who: null },
    ],
    backlogIssues: [
      { s: 'Backlog item one', orig: '2d', cur: '2d' },
      { s: 'Backlog item two', orig: '3d', cur: '3d' },
      { s: 'Backlog item three', orig: '1d', cur: '1d' },
    ],
  }, log);

  const two = await seedProject(c, {
    name: 'Capacity Two',
    key: 'SCPE2',
    boardName: 'Capacity Two Board',
    sprintName: 'Two S1',
    projectMembers: ['bob'],
    config: ({ boardId }) => ({
      version: 3,
      boardId,
      originalEffortField: 'Original Effort',
      currentEffortField: 'Current Effort',
      hoursPerDay: 6,
      sprintLengthDays: 7,
      datePolicy: 'continuous',
      nameTemplate: 'Two S{sequence}',
      backlogQuery: 'project: SCPE2 State: Open',
      learningRate: 0.2,
      teams: [
        {
          id: 'team-1',
          name: 'Team 1',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'bob', enabled: true, allocation: 1 },
          ],
        },
      ],
    }),
    sprintIssues: [
      { s: 'Two work A', state: 'Open', orig: '1d', cur: '1d', who: 'bob' },
      { s: 'Two unassigned', state: 'Open', orig: '2d', cur: '2d', who: null },
    ],
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
      one: { key: 'SCPE1', ...one, teams: [{ id: 'team-1', name: 'Alpha' }, { id: 'team-2', name: 'Beta' }] },
      two: { key: 'SCPE2', ...two, teams: [{ id: 'team-1', name: 'Team 1' }] },
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
