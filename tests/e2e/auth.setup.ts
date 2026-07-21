/**
 * Auth setup project — logs each persona in via the YouTrack login form and saves
 * their storageState for the persona-scoped fixtures. Runs before the critical /
 * regression projects (declared as their dependency in playwright.config.ts).
 *
 * Skips itself when there is no instance, leaving the persona specs to skip too.
 * Login uses id/type selectors (the Hub form's accessible names are unreliable
 * across builds — same proven flow as the demo global-setup). New Hub users may
 * be greeted by an agreement/banner; those are accepted best-effort.
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
  await page.waitForTimeout(2000);
  const username = (await page.$('input#username')) ?? (await page.$('input[type=text]'));
  if (username === null) {
    setup.skip(true, 'login form not found (already authenticated or unexpected page)');
    return;
  }
  await username.fill(persona.login);
  await (await page.$('input[type=password]'))!.fill(persona.password);
  await (await page.$('button[type=submit]'))!.click();
  await page.waitForTimeout(4000);

  // First-login niceties (agreement / notification banners) — accept and move on.
  for (const name of [/^Accept$/i, /^I agree$/i, /^Continue$/i]) {
    const button = page.getByRole('button', { name }).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

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

setup('authenticate eve', async ({ page }) => {
  await login(page, 'eve');
});
