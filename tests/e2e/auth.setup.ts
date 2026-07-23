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
  const onLogin = (u: URL | string): boolean => /\/hub\/auth\/login|[?&]login|\/login\b/i.test(u.toString());
  // Locator-based, not page.$ handles: the Hub login form re-renders/navigates
  // during load on 2026.x, and a captured ElementHandle then goes stale
  // ("Unable to adopt element handle from a different document") — which once hung
  // a setup for ~an hour. Locators re-resolve on each action.
  //
  // Retry the whole submit: 2026.x occasionally establishes no session for one
  // persona and bounces to the silent-SSO login (…?request_credentials=skip);
  // re-entering the credentials clears it. Up to 3 attempts.
  let formSeen = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Let the silent-SSO redirect (…?request_credentials=skip) settle to either the
    // real login form or an authenticated page before we touch anything.
    await page.waitForTimeout(2500);
    if (!onLogin(page.url())) break; // already authenticated
    const username = page.locator('input#username, input[type=text]').first();
    if (!(await username.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false))) {
      continue; // mid-redirect; retry the whole goto
    }
    formSeen = true;
    await username.fill(persona.login);
    await page.locator('input[type=password]').first().fill(persona.password);
    await page.locator('button[type=submit]').first().click();
    // Flat settle for the full submit → OAuth-callback → app redirect chain (the
    // proven flow; a URL-predicate wait raced the silent-SSO bounce).
    await page.waitForTimeout(7000);
    if (!onLogin(page.url())) break;
  }
  if (!formSeen && onLogin(page.url())) {
    setup.skip(true, 'login form never appeared (unexpected auth state)');
    return;
  }

  // First-login niceties (agreement / notification banners) — accept and move on.
  for (const name of [/^Accept$/i, /^I agree$/i, /^Continue$/i]) {
    const button = page.getByRole('button', { name }).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  // Confirm we reached an authenticated view before saving state (the app's own
  // URL — /hub/auth/login is the only "login" URL, matched narrowly).
  await expect(page).not.toHaveURL(/\/hub\/auth\/login|[?&]login|\/login\b/i, { timeout: 20_000 });
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
