/**
 * Authorization, enforced by the real backend (widget visibility is never trusted):
 * members see no manager controls; the project-settings placement is admin-only
 * (a platform rule the main-menu placement exists for); a user with no project role
 * reaches no project at all. Server-side rules are covered by contract tests; here
 * we pin the real UI.
 */
import { MENU_PLANNER_URL, PROJECTS, openPlanner, openPlannerViaMenu, plannerFrame, plannerUrl } from './fixtures/app';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('permissions', () => {
  test('manager sees the manager controls', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    await expect(frame.getByRole('button', { name: 'Create next Sprint' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Override focus factor' })).toBeVisible();
  });

  test('a granted project admin (not the leader) is a manager', async ({ bobPage }) => {
    // bob holds YouTrack's project-admin role on Capacity Two (granted by the seed) —
    // the app's manager role is exactly the UPDATE_PROJECT permission, so bob gets
    // the manager controls there without being the project leader.
    const frame = await openPlannerViaMenu(bobPage, PROJECTS.two.key);
    await expect(frame.getByRole('button', { name: 'Create next Sprint' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    // …while on Capacity One (plain Beta member) bob stays a regular member.
    const one = await openPlannerViaMenu(bobPage, PROJECTS.one.key);
    await expect(one.locator('[data-test="scp-ready"]')).toBeVisible();
    await expect(one.getByRole('button', { name: 'Create next Sprint' })).toHaveCount(0);
  });

  test('a member sees no manager controls', async ({ alicePage }) => {
    const frame = await openPlannerViaMenu(alicePage, PROJECTS.one.key);
    await expect(frame.locator('[data-test="scp-ready"]')).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Create next Sprint' })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Override focus factor' })).toHaveCount(0);
    // Board cards are not draggable for members.
    const card = frame.locator('[data-test="scp-card"]').first();
    await expect(card).toHaveAttribute('draggable', 'false');
  });

  test('a member can also use the project-settings tab, read-only', async ({ alicePage }) => {
    // Both entry points work for members: the settings tab renders the same planner
    // (without manager controls) once the board is project-visible.
    await alicePage.goto(plannerUrl(PROJECTS.one.key), { waitUntil: 'domcontentloaded' });
    const frame = await plannerFrame(alicePage);
    await frame.locator('[data-test="scp-ready"]').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(frame.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  });

  test('a user with no project role sees no projects anywhere', async ({ evePage }) => {
    // The settings tab of a project eve cannot see:
    await evePage.goto(plannerUrl(PROJECTS.one.key), { waitUntil: 'domcontentloaded' });
    await evePage.waitForTimeout(4000);
    const body = (await evePage.textContent('body')) ?? '';
    expect(body).not.toContain('Sprint capacity');
    expect(body).not.toContain('Raw capacity');

    // And the members' menu placement offers her nothing: either the host doesn't
    // render the widget for her at all, or the picker shows its empty state.
    await evePage.goto(MENU_PLANNER_URL, { waitUntil: 'domcontentloaded' });
    const frame = await plannerFrame(evePage, 15_000).catch(() => null);
    if (frame !== null) {
      await expect(frame.getByText('No projects available')).toBeVisible();
    } else {
      const menuBody = (await evePage.textContent('body')) ?? '';
      expect(menuBody).not.toContain('Raw capacity');
      expect(menuBody).not.toContain('Choose the project');
    }
  });
});
