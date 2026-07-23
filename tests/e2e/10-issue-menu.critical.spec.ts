/**
 * The ISSUE_OPTIONS_MENU_ITEM entry point ("Sprint Planner" in an issue's ⋯ menu):
 * opening it from ANY issue must load the planner scoped to that issue's PROJECT.
 * This path is distinct from the settings tab and the main-menu item — the host
 * entity is the ISSUE (not the project), and the planner must resolve the issue's
 * project rather than mistake the issue id for a project id (which showed an
 * "Unable to load" error before the fix). Critical spec → video is always recorded.
 */
import { PROJECTS, plannerFrame } from './fixtures/app';
import { firstIssueId, hasAdminRest } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');
test.skip(!hasAdminRest, 'needs YT_TEST_ADMIN_TOKEN to resolve an issue id');

/** Open the issue's ⋯ options menu and click the app's "Sprint Planner" item. */
async function openPlannerFromIssueMenu(page: import('@playwright/test').Page): Promise<void> {
  // The ISSUE TOOLBAR's ⋯ button carries an aria-label containing "more" (the
  // left-sidebar "More" nav item has text, not that aria-label — don't match it).
  await page.locator('button[aria-label*="more" i]').first().click();
  const item = page.getByText('Sprint Planner', { exact: true }).last();
  // The item sits at the bottom of a scrollable menu — let the click auto-scroll it.
  await item.scrollIntoViewIfNeeded();
  await item.click();
}

test.describe('issue options menu', () => {
  test('opening "Sprint Planner" from an issue loads the planner for its project', async ({
    managerPage,
  }) => {
    // SCPE1 (multi-team, configured) — grab any of its issues.
    const issueId = await firstIssueId(PROJECTS.one.key);
    expect(issueId, 'the seeded project should have at least one issue').not.toBeNull();

    await managerPage.goto(`/issue/${issueId}`, { waitUntil: 'domcontentloaded' });
    await managerPage.waitForTimeout(2500);
    await openPlannerFromIssueMenu(managerPage);

    // The app opens in a dialog iframe; it must reach the READY planner (not the
    // "Unable to load" error state the issue-id-as-project-id bug produced).
    const frame = await plannerFrame(managerPage);
    await expect(frame.locator('[data-test="scp-ready"]')).toBeVisible({ timeout: 30_000 });
    await expect(frame.locator('body')).not.toContainText('Unable to load');

    // Scoped to SCPE1: the capacity section is present, and (multi-team) names a team.
    await expect(frame.locator('[data-test="scp-capacity-section"]')).toBeVisible();
    await expect(frame.locator('[data-test="scp-capacity-section"] h2')).toContainText('Capacity');

    // A managed Sprint is auto-selected (the planner opens on a real Sprint, not empty).
    await expect(frame.getByRole('combobox', { name: 'Select a Sprint' })).not.toBeEmpty();

    // NOTHING OVERFLOWS the narrow dialog: the widget content must fit the dialog
    // viewport (the wide capacity table scrolls within its own card, not the widget).
    const fits = await frame.evaluate(() => {
      const root = document.querySelector('[data-test="scp-ready"]') as HTMLElement | null;
      return root !== null && root.scrollWidth <= document.documentElement.clientWidth + 2;
    });
    expect(fits, 'the planner must not overflow the issue-menu dialog width').toBeTruthy();
  });
});
