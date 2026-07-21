/**
 * Persona definitions for the E2E suite. Credentials come from the e2e seed manifest
 * (artifacts/e2e-env.json, written by scripts/seed-e2e.mjs) with YT_TEST_* env vars
 * as overrides and sensible container defaults as the last resort.
 *
 * Four personas exercise the permission model:
 *   - manager: the admin account — project leader of both seeded projects (= manager)
 *   - alice: member of project One's "Alpha" team (own availability only)
 *   - bob:   member of One's "Beta" team and of project Two's single team
 *   - eve:   authenticated user with NO project role (access denials)
 */
import { readFileSync } from 'node:fs';
import { storageStatePaths } from '../../../playwright.config';

export type PersonaId = 'manager' | 'alice' | 'bob' | 'eve';

export interface Persona {
  id: PersonaId;
  login: string;
  password: string;
  storageState: string;
}

interface SeedManifest {
  baseUrl?: string;
  projects?: Record<
    string,
    { key: string; projectId: string; boardId: string; sprintId: string; sprintName: string; teams: Array<{ id: string; name: string }> }
  >;
  personas?: Partial<Record<PersonaId, { login: string; password?: string }>>;
}

function readManifest(): SeedManifest {
  try {
    return JSON.parse(readFileSync('artifacts/e2e-env.json', 'utf8')) as SeedManifest;
  } catch {
    return {};
  }
}

/** The seed manifest (projects/boards/sprints ids) — empty when not provisioned. */
export const seedManifest = readManifest();

const seeded = seedManifest.personas ?? {};

export const personas: Record<PersonaId, Persona> = {
  manager: {
    id: 'manager',
    login: process.env.YT_TEST_MANAGER_LOGIN ?? seeded.manager?.login ?? 'admin',
    password: process.env.YT_TEST_MANAGER_PASSWORD ?? seeded.manager?.password ?? 'adminPass123!',
    storageState: storageStatePaths.manager,
  },
  alice: {
    id: 'alice',
    login: process.env.YT_TEST_ALICE_LOGIN ?? seeded.alice?.login ?? 'alice',
    password: process.env.YT_TEST_ALICE_PASSWORD ?? seeded.alice?.password ?? 'Passw0rd!',
    storageState: storageStatePaths.alice,
  },
  bob: {
    id: 'bob',
    login: process.env.YT_TEST_BOB_LOGIN ?? seeded.bob?.login ?? 'bob',
    password: process.env.YT_TEST_BOB_PASSWORD ?? seeded.bob?.password ?? 'Passw0rd!',
    storageState: storageStatePaths.bob,
  },
  eve: {
    id: 'eve',
    login: process.env.YT_TEST_EVE_LOGIN ?? seeded.eve?.login ?? 'eve',
    password: process.env.YT_TEST_EVE_PASSWORD ?? seeded.eve?.password ?? 'Passw0rd!',
    storageState: storageStatePaths.eve,
  },
};

/** True when the E2E suite has a real instance to talk to. */
export const hasInstance = Boolean(process.env.YT_TEST_BASE_URL);
