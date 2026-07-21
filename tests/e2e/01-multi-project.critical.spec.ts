/**
 * Per-project independence: two projects (SCPE1 / SCPE2) are configured with
 * deliberately different boards, schedules, templates and teams — the app must show
 * each project ITS OWN configuration, and a change in one must never leak into the
 * other. Runs first (01-) so it sees the pristine seeded configs.
 */
import { PROJECTS, openPlanner, openRingSelect, openSettings } from './fixtures/app';
import { appConfig, hasAdminRest } from './fixtures/rest';
import { assertNoBlockingA11yViolations } from './fixtures/axe';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('per-project settings independence', () => {
  test('each project shows its own configuration', async ({ managerPage }, testInfo) => {
    // Project One: 14-day sprints, 8h days, two teams, its own board.
    const one = await openSettings(managerPage, PROJECTS.one.key);
    await expect(one.getByLabel(/Sprint length/i)).toHaveValue('14');
    await expect(one.getByLabel(/Hours per day/i)).toHaveValue('8');
    await expect(one.getByLabel('Naming template', { exact: false })).toHaveValue('One S{sequence}');
    await expect(one.getByLabel('Backlog search query')).toHaveValue('project: SCPE1 State: Open');
    await expect(one.locator('[data-test="scp-team-card"]')).toHaveCount(2);

    await assertNoBlockingA11yViolations(managerPage, testInfo, 'settings-one');

    // Project Two: 7-day sprints, 6h days, ONE team (flat section, no team cards).
    const two = await openSettings(managerPage, PROJECTS.two.key);
    await expect(two.getByLabel(/Sprint length/i)).toHaveValue('7');
    await expect(two.getByLabel(/Hours per day/i)).toHaveValue('6');
    await expect(two.getByLabel('Naming template', { exact: false })).toHaveValue('Two S{sequence}');
    await expect(two.getByLabel('Backlog search query')).toHaveValue('project: SCPE2 State: Open');
    await expect(two.locator('[data-test="scp-team-card"]')).toHaveCount(0);
  });

  test('each project plans its own sprints', async ({ managerPage }) => {
    const one = await openPlanner(managerPage, PROJECTS.one.key);
    await expect(one.locator('body')).toContainText(PROJECTS.one.sprintName);
    await expect(one.locator('body')).not.toContainText(PROJECTS.two.sprintName);

    const two = await openPlanner(managerPage, PROJECTS.two.key);
    await expect(two.locator('body')).toContainText(PROJECTS.two.sprintName);
    await expect(two.locator('body')).not.toContainText(PROJECTS.one.sprintName);
  });

  test('editing one project leaves the other untouched', async ({ managerPage }) => {
    // Change Two's template, save, verify One is unaffected, then restore Two.
    const two = await openSettings(managerPage, PROJECTS.two.key);
    const template = two.getByLabel('Naming template', { exact: false });
    await template.fill('Two X{sequence}');
    await two.getByRole('button', { name: 'Save settings' }).click();
    await expect(two.getByText('Settings saved.')).toBeVisible();

    const one = await openSettings(managerPage, PROJECTS.one.key);
    await expect(one.getByLabel('Naming template', { exact: false })).toHaveValue('One S{sequence}');

    if (hasAdminRest) {
      // Backend agrees: the two stored configs differ exactly as edited.
      expect((await appConfig(PROJECTS.two.key)).config?.nameTemplate).toBe('Two X{sequence}');
      expect((await appConfig(PROJECTS.one.key)).config?.nameTemplate).toBe('One S{sequence}');
    }

    const twoAgain = await openSettings(managerPage, PROJECTS.two.key);
    await twoAgain.getByLabel('Naming template', { exact: false }).fill('Two S{sequence}');
    await twoAgain.getByRole('button', { name: 'Save settings' }).click();
    await expect(twoAgain.getByText('Settings saved.')).toBeVisible();
  });

  test('board picker only offers the project own boards', async ({ managerPage }) => {
    const two = await openSettings(managerPage, PROJECTS.two.key);
    const popup = await openRingSelect(two, 'Select a board');
    await expect(popup).toContainText('Capacity Two Board');
    await expect(popup).not.toContainText('Capacity One Board');
  });
});
