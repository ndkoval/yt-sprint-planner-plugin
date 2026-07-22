/**
 * Shared contract-test setup: a seeded project world plus small helpers to drive the
 * backend request handlers directly. Individual tests mutate the returned env/project
 * to model the scenario under test. The baseline config is a v4 (per-team settings)
 * document with a single default team holding both members.
 */
import type { RequestContext } from '../../src/backend/handlers.js';
import type { ProjectConfig, Team } from '../../src/shared/types.js';
import { FakeEnv, FakeProject } from './fake-env.js';

export const PROJECT_KEY = 'AGP';
export const BOARD_ID = 'board-1';
/** A second board id for two-team scenarios (teams may plan on different boards). */
export const BOARD_2_ID = 'board-2';

/** Team id of the baseline single team (matches what the v2→v3 migration assigns). */
export const TEAM_ID = 'team-1';
/** Second team id used by {@link twoTeamConfig}. */
export const TEAM_2_ID = 'team-2';

/** A fixed "now" well after every seeded sprint window, so sprints read as completed. */
export const NOW = Date.UTC(2026, 5, 1); // 2026-06-01

// Personas. The app has NO permission scheme of its own: a "manager" is whoever
// holds YouTrack's UPDATE_PROJECT right, plus the project leader as a bootstrap.
export const MEMBER = { login: 'member', name: 'Member One', canUpdateProject: false };
export const MEMBER_2 = { login: 'member2', name: 'Member Two', canUpdateProject: false };
/** A NON-leader user holding UPDATE_PROJECT — a manager purely by permission. */
export const MANAGER = { login: 'manager', name: 'Manager Boss', canUpdateProject: true };
/** The project leader WITHOUT UPDATE_PROJECT — a manager purely by leadership. */
export const LEADER = { login: 'leader', name: 'Project Leader', canUpdateProject: false };

/**
 * The baseline team: both members enabled, full-time. Since config v4 the team
 * carries its FULL planning configuration (board, effort fields, cadence, backlog,
 * learning rate).
 */
export function defaultTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    name: 'Team 1',
    participants: [
      { userId: MEMBER.login, enabled: true, allocation: 1 },
      { userId: MEMBER_2.login, enabled: true, allocation: 1 },
    ],
    boardId: BOARD_ID,
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'Sprint {sequence}',
    backlogQuery: '',
    learningRate: 0.5,
    ...overrides,
  };
}

export function defaultConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 4,
    teams: [defaultTeam()],
    ...overrides,
  };
}

/**
 * Two fully separated teams: MEMBER alone in "Alpha" (team-1, board-1) and MEMBER_2
 * alone in "Beta" (team-2, board-2 — its own board and weekly cadence).
 */
export function twoTeamConfig(): ProjectConfig {
  return defaultConfig({
    teams: [
      defaultTeam({
        name: 'Alpha',
        participants: [{ userId: MEMBER.login, enabled: true, allocation: 1 }],
      }),
      defaultTeam({
        id: TEAM_2_ID,
        name: 'Beta',
        participants: [{ userId: MEMBER_2.login, enabled: true, allocation: 1 }],
        boardId: BOARD_2_ID,
        sprintLengthDays: 7,
      }),
    ],
  });
}

export interface World {
  env: FakeEnv;
  project: FakeProject;
}

/** Overwrite the stored config document (models a config edit between requests). */
export function storeConfig(world: World, config: ProjectConfig, revision = 2): void {
  world.project.setProperty('scpConfigJson', JSON.stringify({ version: 4, revision, config }));
}

/**
 * Build a fake env seeded with users, a project (led by LEADER), and — unless
 * `configured: false` — a stored v4 config document at the given revision.
 */
export function seedWorld(
  options: { configured?: boolean; config?: ProjectConfig; revision?: number; now?: number } = {},
): World {
  const env = new FakeEnv(options.now ?? NOW);
  env.seedUser(MEMBER).seedUser(MEMBER_2).seedUser(MANAGER).seedUser(LEADER);
  const project = env.seedProject(PROJECT_KEY, LEADER.login);
  if (options.configured !== false) {
    project.setProperty(
      'scpConfigJson',
      JSON.stringify({
        version: 4,
        revision: options.revision ?? 1,
        config: options.config ?? defaultConfig(),
      }),
    );
  }
  return { env, project };
}

/** Build the request context for a given caller login against the seeded project. */
export function ctxFor(world: World, login: string): RequestContext {
  return { env: world.env, user: world.env.caller(login), project: world.project };
}
