/**
 * Shared contract-test setup: a fully-seeded world (users, board, configured
 * project) plus small helpers to drive the app router. Individual tests mutate the
 * returned fake to model the scenario under test.
 */
import { createApp } from '../../src/backend/app.js';
import { fixedClock, type Clock } from '../../src/backend/clock.js';
import type { Router, HttpMethod } from '../../src/backend/http/router.js';
import type { ProjectConfig } from '../../src/shared/types.js';
import type { YtUser } from '../../src/backend/repositories/youtrack-client.js';
import { FakeYouTrack } from './fake-youtrack.js';

export const PROJECT_ID = 'proj-1';
export const BOARD_ID = 'board-1';
export const MANAGERS_GROUP = 'Capacity Managers';

/** A fixed "now" well after every seeded sprint window, so sprints read as completed. */
export const NOW = Date.UTC(2026, 5, 1); // 2026-06-01

export const MEMBER: YtUser = { id: '1-10', login: 'member', name: 'Member One' };
export const MEMBER_2: YtUser = { id: '1-20', login: 'member2', name: 'Member Two' };
export const MANAGER: YtUser = { id: '1-99', login: 'manager', name: 'Manager Boss' };
export const DISABLED_USER: YtUser = { id: '1-30', login: 'disabled', name: 'Disabled User' };

export function defaultConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    boardId: BOARD_ID,
    originalEffortField: 'Original estimation',
    currentEffortField: 'Estimation',
    hoursPerDay: 8,
    sprintLengthDays: 14,
    firstSprintStart: '2026-01-05', // Monday
    datePolicy: 'continuous',
    nameTemplate: 'AppGlass {year}-S{sequence}',
    bootstrapFocusFactor: 0.7,
    learningRate: 0.5,
    maxFactorStep: 0.1,
    minFocusFactor: 0.3,
    maxFocusFactor: 0.9,
    participants: [
      { userId: MEMBER.id, enabled: true },
      { userId: MEMBER_2.id, enabled: true },
      { userId: DISABLED_USER.id, enabled: false },
    ],
    ...overrides,
  };
}

/** Build a fake seeded with users, a sprint board, effort fields and (optionally) config. */
export function seedWorld(
  options: { configured?: boolean; config?: ProjectConfig } = {},
): FakeYouTrack {
  const fake = new FakeYouTrack();
  fake
    .seedUser(MEMBER)
    .seedUser(MEMBER_2)
    .seedUser(MANAGER)
    .seedUser(DISABLED_USER)
    .seedBoard({ id: BOARD_ID, name: 'AppGlass Board', usesSprints: true, projectIds: [PROJECT_ID] })
    .addGroupMember(MANAGERS_GROUP, MANAGER.id)
    .setProjectFields(PROJECT_ID, [
      { name: 'Original estimation', type: 'period', attachedToProject: true },
      { name: 'Estimation', type: 'period', attachedToProject: true },
      { name: 'Text Field', type: 'string', attachedToProject: true },
    ]);
  fake.currentUserId = MEMBER.id;
  if (options.configured !== false) {
    fake.seedConfiguredProject({
      projectId: PROJECT_ID,
      config: options.config ?? defaultConfig(),
      revision: 1,
      managersGroup: MANAGERS_GROUP,
    });
  }
  return fake;
}

export function app(fake: FakeYouTrack, clock: Clock = fixedClock(NOW)): Router {
  return createApp({ client: fake, clock });
}

export interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
}

/** Drive one request through the router with projectId defaulted into the query. */
export function request(
  router: Router,
  method: HttpMethod,
  path: string,
  opts: RequestOptions = {},
): Promise<{ status: number; body: unknown }> {
  return router.handle({
    method,
    path,
    query: { projectId: PROJECT_ID, ...(opts.query ?? {}) },
    body: opts.body ?? null,
  });
}
