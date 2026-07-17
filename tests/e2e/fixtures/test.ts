/**
 * Extended Playwright test with persona-scoped page fixtures.
 *
 * Each persona fixture opens a fresh browser context using that persona's stored
 * auth state, so a single test can drive Manager, Alice, Bob and an Unauthorized
 * user against the same instance (needed for the permission + conflict journeys).
 *
 * All specs should gate on `hasInstance` via `test.skip(!hasInstance, ...)`.
 */
import { test as base, type Page } from '@playwright/test';
import { personas, type PersonaId } from './personas';

interface PersonaFixtures {
  managerPage: Page;
  alicePage: Page;
  bobPage: Page;
  unauthorizedPage: Page;
}

async function personaPage(
  browser: import('@playwright/test').Browser,
  id: PersonaId,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: personas[id].storageState });
  const page = await context.newPage();
  try {
    await use(page);
  } finally {
    await context.close();
  }
}

export const test = base.extend<PersonaFixtures>({
  managerPage: async ({ browser }, use) => {
    await personaPage(browser, 'manager', use);
  },
  alicePage: async ({ browser }, use) => {
    await personaPage(browser, 'alice', use);
  },
  bobPage: async ({ browser }, use) => {
    await personaPage(browser, 'bob', use);
  },
  unauthorizedPage: async ({ browser }, use) => {
    await personaPage(browser, 'unauthorized', use);
  },
});

export { expect } from '@playwright/test';
export { hasInstance } from './personas';
