/**
 * Demo/E2E world seed. Builds an in-memory {@link FakeYouTrack} populated with a
 * configured project, an agile board, a team, and two managed Sprints (one completed,
 * one active) with realistic issues — then runs the REAL reconciliation service so the
 * cached metrics the UI reads are genuine, not hand-written.
 *
 * This is the same transport-boundary fake the contract tests use, so the demo drives
 * the real widget bundles against the real backend logic; only YouTrack itself is
 * in-memory.
 */
import { fixedClock } from '../../../src/backend/clock.js';
import { ReconciliationService } from '../../../src/backend/services/reconciliation-service.js';
import { seedCapacityDocument } from '../../../src/backend/services/capacity-init.js';
import { SprintRepository } from '../../../src/backend/repositories/sprint-repository.js';
import type { ProjectConfig } from '../../../src/shared/types.js';
import type { YtIssue, YtUser } from '../../../src/backend/repositories/youtrack-client.js';
import { FakeYouTrack } from '../../contract/fake-youtrack.js';

export const DEMO = {
  projectId: 'proj-demo',
  boardId: 'board-demo',
  managersGroup: 'Capacity Managers',
  now: Date.UTC(2026, 6, 20), // 2026-07-20, inside the active sprint
};

export const PERSONAS: Record<string, YtUser> = {
  manager: { id: '1-99', login: 'manager', name: 'Morgan Manager' },
  alice: { id: '1-1', login: 'alice', name: 'Alice Smith' },
  bob: { id: '1-2', login: 'bob', name: 'Bob Jones' },
  charlie: { id: '1-3', login: 'charlie', name: 'Charlie Diaz' },
};

const HOURS_PER_DAY = 8;
const DAY = 24 * 60 * 60 * 1000;

function demoConfig(): ProjectConfig {
  return {
    version: 1,
    boardId: DEMO.boardId,
    originalEffortField: 'Original Effort',
    currentEffortField: 'Current Effort',
    hoursPerDay: HOURS_PER_DAY,
    sprintLengthDays: 14,
    firstSprintStart: '2026-06-22',
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    bootstrapFocusFactor: 0.75,
    learningRate: 0.2,
    maxFactorStep: 0.03,
    minFocusFactor: 0.55,
    maxFocusFactor: 0.9,
    participants: [
      { userId: PERSONAS.alice.id, enabled: true },
      { userId: PERSONAS.bob.id, enabled: true },
      { userId: PERSONAS.charlie.id, enabled: true },
    ],
  };
}

/** Build and fully seed the demo world; returns the fake ready to serve. */
export async function buildDemoWorld(): Promise<FakeYouTrack> {
  const fake = new FakeYouTrack();
  const config = demoConfig();

  for (const u of Object.values(PERSONAS)) fake.seedUser(u);
  fake.seedBoard({
    id: DEMO.boardId,
    name: 'AppGlass Board',
    usesSprints: true,
    projectIds: [DEMO.projectId],
  });
  fake.addGroupMember(DEMO.managersGroup, PERSONAS.manager.id);
  fake.grantBoardPermission(DEMO.boardId, PERSONAS.manager.id);
  fake.setProjectFields(DEMO.projectId, [
    { name: 'Original Effort', type: 'period', attachedToProject: true },
    { name: 'Current Effort', type: 'period', attachedToProject: true },
  ]);
  fake.seedConfiguredProject({
    projectId: DEMO.projectId,
    config,
    revision: 1,
    managersGroup: DEMO.managersGroup,
  });

  const users = Object.values(PERSONAS);

  // ---- Sprint 1: completed (drives Observed Focus Factor + calibration) ----
  const s1Start = '2026-06-22';
  const s1Finish = '2026-07-05';
  const s1Cap = seedCapacityDocument(config, users, s1Start, s1Finish, DEMO.now - 20 * DAY);
  // Mark everyone confirmed for the completed sprint.
  for (const row of Object.values(s1Cap.rows)) {
    row.confirmed = true;
  }
  const s1Issues: YtIssue[] = [
    { id: 'AG-1', originalEffortMinutes: 4800, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 5, 25) },
    { id: 'AG-2', originalEffortMinutes: 2400, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 6, 1) },
    { id: 'AG-3', originalEffortMinutes: 3600, currentEffortMinutes: 1200, resolved: false, resolvedAt: null },
  ];
  fake.seedManagedSprint({
    boardId: DEMO.boardId,
    projectId: DEMO.projectId,
    sprint: { id: 'sprint-1', name: 'AppGlass 2026-S1', goal: 'Ship the first customer preview', start: s1Start, finish: s1Finish, archived: false },
    sequence: 1,
    focusFactor: 0.75,
    focusFactorSource: 'bootstrap',
    capacity: s1Cap,
    issues: s1Issues,
  });

  // ---- Sprint 2: active (drives the main capacity + effort views) ----
  const s2Start = '2026-07-06';
  const s2Finish = '2026-07-19';
  const s2Cap = seedCapacityDocument(config, users, s2Start, s2Finish, DEMO.now - 4 * DAY);
  // Alice customised availability + confirmed; Bob confirmed; Charlie pending with a note.
  const alice = s2Cap.rows[PERSONAS.alice.id];
  if (alice) { alice.availableMinutes = 3840; alice.availableWasCustomized = true; alice.confirmed = true; alice.note = 'Vacation Thu–Fri'; }
  const bob = s2Cap.rows[PERSONAS.bob.id];
  if (bob) { bob.confirmed = true; }
  const charlie = s2Cap.rows[PERSONAS.charlie.id];
  if (charlie) { charlie.note = 'Conference week 2'; }
  const s2Issues: YtIssue[] = [
    { id: 'AG-10', originalEffortMinutes: 4800, currentEffortMinutes: 2400, resolved: false, resolvedAt: null, assigneeId: PERSONAS.alice.id },
    { id: 'AG-11', originalEffortMinutes: 2400, currentEffortMinutes: 0, resolved: true, resolvedAt: Date.UTC(2026, 6, 10), assigneeId: PERSONAS.alice.id },
    { id: 'AG-12', originalEffortMinutes: 3600, currentEffortMinutes: 1800, resolved: false, resolvedAt: null, assigneeId: PERSONAS.bob.id },
    { id: 'AG-13', originalEffortMinutes: null, currentEffortMinutes: 600, resolved: false, resolvedAt: null, assigneeId: null }, // missing Original Effort, unassigned
  ];
  fake.seedManagedSprint({
    boardId: DEMO.boardId,
    projectId: DEMO.projectId,
    sprint: { id: 'sprint-2', name: 'AppGlass 2026-S2', goal: 'Deliver a usable first customer deployment', start: s2Start, finish: s2Finish, archived: false },
    sequence: 2,
    focusFactor: 0.73,
    focusFactorSource: 'calculated',
    capacity: s2Cap,
    issues: s2Issues,
  });

  // ---- Run the REAL reconciliation so cached metrics are genuine ----
  const clock = fixedClock(DEMO.now);
  const repo = new SprintRepository(fake, DEMO.boardId);
  const reconciler = new ReconciliationService(fake, repo, clock);
  for (const id of ['sprint-1', 'sprint-2']) {
    const sprint = await fake.getSprint(DEMO.boardId, id);
    if (!sprint) continue;
    const record = await repo.load(sprint, DEMO.projectId);
    await reconciler.reconcile(record, config, DEMO.boardId, null);
  }

  return fake;
}
