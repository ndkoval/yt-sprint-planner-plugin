/**
 * Auth setup project — logs each persona in via the YouTrack login form and saves
 * their storageState for the persona-scoped fixtures. Runs before the critical /
 * regression projects (declared as their dependency in playwright.config.ts).
 *
 * Skips itself when there is no instance, leaving the persona specs to skip too.
 *
 * SPIKE: the YouTrack Hub login form selectors are version-specific; confirm the
 * username/password field + submit control on the target build.
 */
import { test as setup, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { personas, hasInstance, type PersonaId } from './fixtures/personas';

setup.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

async function login(
  page: import('@playwright/test').Page,
  id: PersonaId,
): Promise<void> {
  const persona = personas[id];
  if (!persona.login) {
    setup.skip(true, `no credentials for persona ${id}`);
    return;
  }
  await page.goto('/');
  // SPIKE: Hub login form. Try the common Ring UI login fields, fall back by label.
  const username = page
    .getByRole('textbox', { name: /username|login|e-?mail/i })
    .or(page.locator('input[name="username"], input#username'))
    .first();
  const password = page
    .getByRole('textbox', { name: /password/i })
    .or(page.locator('input[type="password"], input[name="password"]'))
    .first();

  await username.fill(persona.login);
  await password.fill(persona.password);
  await page
    .getByRole('button', { name: /log ?in|sign ?in/i })
    .first()
    .click();

  // Confirm we reached an authenticated view before saving state.
  await expect(page).not.toHaveURL(/login/i, { timeout: 15_000 });
  await mkdir(path.dirname(persona.storageState), { recursive: true });
  await page.context().storageState({ path: persona.storageState });
}

setup('authenticate manager', async ({ page }) => {
  await login(page, 'manager');
});

setup('authenticate alice', async ({ page }) => {
  await login(page, 'alice');
});

setup('authenticate bob', async ({ page }) => {
  await login(page, 'bob');
});

setup('authenticate unauthorized', async ({ page }) => {
  await login(page, 'unauthorized');
});
