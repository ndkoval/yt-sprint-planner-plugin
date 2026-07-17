/**
 * Persona definitions for the E2E suite, sourced from YT_TEST_* env vars (§26/§27).
 *
 * Four personas exercise the permission model:
 *   - manager: capacity manager (full config + create-next-sprint)
 *   - alice / bob: team members (own availability only)
 *   - unauthorized: authenticated user with no project role (permission denials)
 */
import { storageStatePaths } from '../../../playwright.config';

export type PersonaId = 'manager' | 'alice' | 'bob' | 'unauthorized';

export interface Persona {
  id: PersonaId;
  login: string;
  password: string;
  storageState: string;
}

export const personas: Record<PersonaId, Persona> = {
  manager: {
    id: 'manager',
    login: process.env.YT_TEST_MANAGER_LOGIN ?? '',
    password: process.env.YT_TEST_MANAGER_PASSWORD ?? '',
    storageState: storageStatePaths.manager,
  },
  alice: {
    id: 'alice',
    login: process.env.YT_TEST_ALICE_LOGIN ?? '',
    password: process.env.YT_TEST_ALICE_PASSWORD ?? '',
    storageState: storageStatePaths.alice,
  },
  bob: {
    id: 'bob',
    login: process.env.YT_TEST_BOB_LOGIN ?? '',
    password: process.env.YT_TEST_BOB_PASSWORD ?? '',
    storageState: storageStatePaths.bob,
  },
  unauthorized: {
    id: 'unauthorized',
    // The unauthorized persona reuses Bob's credentials but against a project where
    // Bob has no role — or a throwaway account. Login is best-effort.
    login: process.env.YT_TEST_BOB_LOGIN ?? '',
    password: process.env.YT_TEST_BOB_PASSWORD ?? '',
    storageState: storageStatePaths.unauthorized,
  },
};

/** True when the E2E suite has a real instance to talk to. */
export const hasInstance = Boolean(process.env.YT_TEST_BASE_URL);
