/**
 * Member availability: a team member edits their OWN capacity row and the change
 * persists (compute-on-read — Raw capacity follows without any refresh button).
 * No confirmation step exists; availability updates immediately on commit.
 *
 * Members reach the planner through the MAIN MENU placement here (its project
 * picker is the members' front door); the settings-tab route works for them too
 * and is pinned separately in the permissions spec.
 */
import { PROJECTS, openPlanner, openPlannerViaMenu } from './fixtures/app';
import { assertNoBlockingA11yViolations } from './fixtures/axe';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('availability', () => {
  test('alice edits her own capacity and it persists', async ({ alicePage }, testInfo) => {
    const frame = await openPlannerViaMenu(alicePage, PROJECTS.one.key);
    const input = frame.getByLabel(/Available capacity in days for Alice/i);
    await expect(input).toBeEnabled();
    await input.fill('7');
    await input.blur();
    // Wait for the commit round-trip (the draft clears and the input shows the
    // SERVER value) before navigating — leaving early can abort the save.
    await expect(input).toHaveValue('7', { timeout: 15_000 });
    // The value must survive a full reload.
    const reloaded = await openPlannerViaMenu(alicePage, PROJECTS.one.key);
    await expect(reloaded.getByLabel(/Available capacity in days for Alice/i)).toHaveValue('7');

    await assertNoBlockingA11yViolations(alicePage, testInfo, 'planner-alice');
  });

  test("alice cannot edit admin's capacity row", async ({ alicePage }) => {
    const frame = await openPlannerViaMenu(alicePage, PROJECTS.one.key);
    // Admin's row is visible to everyone, but rows one may not edit render as plain
    // text — no input exists for them (alice's own row keeps its input).
    const adminRow = frame.locator('tr', { hasText: /Nikita|admin/ }).first();
    await expect(adminRow).toBeVisible();
    await expect(adminRow.locator('input')).toHaveCount(0);
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).toBeVisible();
  });

  test('manager edits a teammate row and Raw capacity follows', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const input = frame.getByLabel(/Available capacity in days for Alice/i);
    await expect(input).toBeEnabled();
    await input.fill('6');
    await input.blur();
    await expect(input).toHaveValue('6', { timeout: 15_000 });
    const reloaded = await openPlanner(managerPage, PROJECTS.one.key);
    await expect(reloaded.getByLabel(/Available capacity in days for Alice/i)).toHaveValue('6');
    // Compute-on-read: the capacity summary reflects the new number without a refresh
    // control (Alpha = admin 10d + alice 6d = 16d raw for a 14-day/8h sprint).
    await expect(reloaded.locator('[data-test="scp-capacity-summary"]')).toContainText('Raw capacity');
  });
});
