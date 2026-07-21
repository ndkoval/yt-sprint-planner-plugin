/**
 * Shared contract-test setup: a seeded project world plus small helpers to drive the
 * backend request handlers directly. Individual tests mutate the returned env/project
 * to model the scenario under test.
 */
import type { RequestContext } from '../../src/backend/handlers.js';
import type { ProjectConfig } from '../../src/shared/types.js';
import { FakeEnv, FakeProject } from './fake-env.js';

export const PROJECT_KEY = 'AGP';
export const BOARD_ID = 'board-1';
export const MANAGERS_GROUP = 'Capacity Managers';

/** A fixed "now" well after every seeded sprint window, so sprints read as completed. */
export const NOW = Date.UTC(2026, 5, 1); // 2026-06-01

export const MEMBER = { login: 'member', name: 'Member One', groups: [] as string[] };
export const MEMBER_2 = { login: 'member2', name: 'Member Two', groups: [] as string[] };
export const MANAGER = { login: 'manager', name: 'Manager Boss', groups: [MANAGERS_GROUP] };
export const LEADER = { login: 'leader', name: 'Project Leader', groups: [] as string[] };

export function defaultConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 2,
    boardId: BOARD_ID,
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    backlogQuery: '',
    learningRate: 0.5,
    managersGroup: MANAGERS_GROUP,
    participants: [
      { userId: MEMBER.login, enabled: true, allocation: 1 },
      { userId: MEMBER_2.login, enabled: true, allocation: 1 },
    ],
    ...overrides,
  };
}

export interface World {
  env: FakeEnv;
  project: FakeProject;
}

/**
 * Build a fake env seeded with users, a project (led by LEADER), and — unless
 * `configured: false` — a stored config document at the given revision.
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
        version: 2,
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
