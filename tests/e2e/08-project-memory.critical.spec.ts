/**
 * The main-menu planner remembers the last-picked project PER USER — stored
 * server-side in the `scpPrefsJson` User extension property (the sandboxed widget
 * iframe has no reliable localStorage), so it survives new sessions and browsers.
 */
import { MENU_PLANNER_URL, PROJECTS, openPlannerViaMenu, plannerFrame } from './fixtures/app';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('the menu planner remembers the last-picked project per user', async ({ bobPage }) => {
  // Pick Capacity Two through the picker…
  await openPlannerViaMenu(bobPage, PROJECTS.two.key);

  // …then a FRESH navigation lands directly on the remembered project — no picker.
  await bobPage.goto(MENU_PLANNER_URL, { waitUntil: 'domcontentloaded' });
  const frame = await plannerFrame(bobPage);
  await frame.locator('[data-test="scp-ready"]').waitFor({ state: 'visible', timeout: 30_000 });
  await expect(frame.locator('[data-test="scp-ready"]')).toContainText(PROJECTS.two.sprintName);

  // "Switch project" clears the preference and reopens the picker…
  await frame.getByRole('button', { name: 'Switch project' }).click();
  await expect(frame.locator('[data-test="scp-project-picker"]')).toBeVisible();

  // …and the cleared preference sticks across navigations too.
  await bobPage.goto(MENU_PLANNER_URL, { waitUntil: 'domcontentloaded' });
  const again = await plannerFrame(bobPage);
  await expect(again.locator('[data-test="scp-project-picker"]')).toBeVisible();
});
