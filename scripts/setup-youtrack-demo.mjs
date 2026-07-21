/**
 * setup-youtrack-demo — make a running YouTrack fully demo-ready for the app:
 *   1. demo users (alice/bob/charlie/dana/erin) via Hub; admin display-named "Nikita Koval"
 *   2. TWO projects, each fully configured (per-project independence is part of the demo):
 *      - AppGlass (AGP): the flagship — TWO teams ("Platform", "Mobile") planning
 *        independently inside shared Sprints; Erin deliberately OFF the teams so the
 *        setup reel adds her live with the picker.
 *      - Orbit CRM (ORB): a second, deliberately different project (one team, 1-week
 *        Sprints, 6-hour days, its own board/template) proving configs don't leak.
 *   3. per project: period effort fields + fresh sprint-enabled board + v3 app config
 *      (via the CURRENT backend API) + one managed Sprint + issues with effort/assignees
 *      (AGP is deliberately over-committed via a chunk of unassigned work).
 *
 * Env: YT_TEST_BASE_URL (default http://localhost:8080); tokens from /tmp/yt25-token.txt
 * (YouTrack scope) and /tmp/yt25-hubtoken.txt (Hub scope, for creating users).
 * Prints a JSON summary. Safe to re-run (idempotent-ish); pair with a clean app install.
 * Project team membership (assignability) is granted via Hub REST inside seedProject.
 */
import { ensureUser, makeClient, renameUser, seedProject } from './lib/seed-lib.mjs';

const log = (...a) => console.log('[setup]', ...a);

runMain().catch((e) => { console.error('SETUP FAILED:', e.message); process.exit(1); });

async function runMain() {
  const c = makeClient();
  log('base', c.base);
  const me = await c.rest('GET', '/api/users/me', undefined, { fields: 'id,ringId' });
  // The demo's main user is Nikita Koval — the person planning the Sprints (logged in during
  // the reels, the primary teammate, the assignee of the lead issues). Creating a separate
  // loginable user isn't reliable via REST, and the reels log in as the admin account, so we
  // give THAT account the display name "Nikita Koval" (its login stays "admin").
  await renameUser(c, me.ringId, 'Nikita Koval');
  // The full cast: Platform + Mobile teammates, part-timers included.
  await ensureUser(c, 'alice', 'Alice Smith');
  await ensureUser(c, 'bob', 'Bob Jones');
  await ensureUser(c, 'charlie', 'Charlie Diaz');
  await ensureUser(c, 'dana', 'Dana Lee');
  await ensureUser(c, 'erin', 'Erin Park');
  log('users ready (admin=Nikita Koval, alice, bob, charlie, dana, erin)');

  // --- AppGlass (AGP): two teams planning independently inside shared Sprints. ------------
  // Platform: Nikita full-time, Alice full-time, Bob HALF-time.
  // Mobile:   Charlie full-time, Dana at 80%.
  // Erin exists as a project member but is on NO team — the setup reel adds her to Mobile.
  const agp = await seedProject(c, {
    name: 'AppGlass',
    key: 'AGP',
    boardName: 'AppGlass Board',
    sprintName: `AppGlass ${new Date().getUTCFullYear()}-S1`,
    // Everyone incl. Erin is a project member (assignable); Erin just isn't on a TEAM yet.
    projectMembers: ['alice', 'bob', 'charlie', 'dana', 'erin'],
    config: ({ boardId }) => ({
      version: 3,
      boardId,
      originalEffortField: 'Original Effort',
      currentEffortField: 'Current Effort',
      hoursPerDay: 8,
      sprintLengthDays: 14,
      datePolicy: 'continuous',
      nameTemplate: 'AppGlass {year}-S{sequence}',
      backlogQuery: 'project: AGP State: Open',
      learningRate: 0.2,
      teams: [
        {
          id: 'team-1',
          name: 'Platform',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'alice', enabled: true, allocation: 1 },
            { userId: 'bob', enabled: true, allocation: 0.5 },
          ],
        },
        {
          id: 'team-2',
          name: 'Mobile',
          participants: [
            { userId: 'charlie', enabled: true, allocation: 1 },
            { userId: 'dana', enabled: true, allocation: 0.8 },
          ],
        },
      ],
    }),
    // A realistic, deliberately over-committed Sprint: each assigned teammate individually
    // fits, but a chunk of high-effort work is left UNASSIGNED, pushing the Sprint over
    // planned capacity — the exact case the planning board highlights.
    sprintIssues: [
      // Platform's work
      { s: 'Checkout API v2', state: 'In Progress', orig: '3d', cur: '2d', who: 'admin' },
      { s: 'Payment retries & idempotency', state: 'Open', orig: '3d', cur: '3d', who: 'admin' },
      { s: 'Capacity table polish', state: 'In Progress', orig: '4d', cur: '2d', who: 'alice' },
      { s: 'Sprint burndown widget', state: 'Open', orig: '3d', cur: '3d', who: 'alice' },
      { s: 'Part-time allocation UI', state: 'Open', orig: '2d', cur: '1d', who: 'bob' },
      // Mobile's work
      { s: 'Board drag-and-drop', state: 'In Progress', orig: '5d', cur: '4d', who: 'charlie' },
      { s: 'Mobile responsive pass', state: 'Open', orig: '4d', cur: '4d', who: 'charlie' },
      { s: 'Focus-factor calibration', state: 'Open', orig: '4d', cur: '4d', who: 'dana' },
      // Nobody's yet — feeds the over-capacity story and the Unassigned lane.
      { s: 'Docs & onboarding', state: 'Open', orig: '4d', cur: '4d', who: null },
      { s: 'Localization polish', state: 'Open', orig: '3d', cur: '3d', who: null },
      { s: 'Accessibility audit fixes', state: 'Open', orig: '4d', cur: '4d', who: null },
      { s: 'Perf: virtualize large boards', state: 'Open', orig: '3d', cur: '3d', who: null },
    ],
    backlogIssues: [
      { s: 'Search indexing revamp', orig: '3d', cur: '3d' },
      { s: 'CSV export for reports', orig: '2d', cur: '2d' },
      { s: 'Audit log for admin actions', orig: '4d', cur: '4d' },
      { s: 'SSO / SAML support', orig: '5d', cur: '5d' },
      { s: 'Dark mode', orig: '2d', cur: '2d' },
    ],
  }, log);

  // --- Orbit CRM (ORB): the contrast project — one small team, its own cadence. -----------
  const orb = await seedProject(c, {
    name: 'Orbit CRM',
    key: 'ORB',
    boardName: 'Orbit Board',
    sprintName: `Orbit ${new Date().getUTCFullYear()}-S1`,
    projectMembers: ['erin'],
    config: ({ boardId }) => ({
      version: 3,
      boardId,
      originalEffortField: 'Original Effort',
      currentEffortField: 'Current Effort',
      hoursPerDay: 6,
      sprintLengthDays: 7,
      datePolicy: 'continuous',
      nameTemplate: 'Orbit {year}-S{sequence}',
      backlogQuery: 'project: ORB State: Open',
      learningRate: 0.3,
      teams: [
        {
          id: 'team-1',
          name: 'Team 1',
          participants: [
            { userId: 'admin', enabled: true, allocation: 1 },
            { userId: 'erin', enabled: true, allocation: 1 },
          ],
        },
      ],
    }),
    sprintIssues: [
      { s: 'Contact dedup engine', state: 'In Progress', orig: '2d', cur: '1d', who: 'erin' },
      { s: 'Email sync connector', state: 'Open', orig: '2d', cur: '2d', who: 'admin' },
      { s: 'Pipeline analytics', state: 'Open', orig: '3d', cur: '3d', who: null },
    ],
    backlogIssues: [
      { s: 'Webhook API', orig: '2d', cur: '2d' },
      { s: 'Mobile quick-add', orig: '1d', cur: '1d' },
    ],
  }, log);

  console.log(JSON.stringify({
    agp: { projectId: agp.projectId, boardId: agp.boardId, sprintId: agp.sprintId, sprintName: agp.sprintName, teams: ['Platform', 'Mobile'] },
    orb: { projectId: orb.projectId, boardId: orb.boardId, sprintId: orb.sprintId, sprintName: orb.sprintName, teams: ['Team 1'] },
  }, null, 2));
}
