/**
 * Sprint lifecycle on a real board: "Create next Sprint" must create a NATIVE
 * YouTrack sprint (verified over REST), register the app state (per-team seeded
 * capacity) and select it in the planner. Runs late (06-) because it permanently
 * extends the managed history of project One.
 */
import { PROJECTS, openPlanner, openRingSelect } from './fixtures/app';
import { boardSprints, hasAdminRest } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('sprint lifecycle', () => {
  test('create next sprint: preview, native sprint, per-team seeding', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    await frame.getByRole('button', { name: 'Create next Sprint' }).click();

    const dialog = frame.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The preview is computed from the latest managed sprint: One S1 → One S2.
    await expect(dialog).toContainText('One S2');
    // Multi-team wording: sprints (and carry-over) span all teams.
    await expect(dialog).toContainText('(all teams)');
    await expect(dialog).toContainText('each team');
    // Programmatic click: the dialog centers within the tall auto-height iframe and
    // can sit outside the viewport where even force-clicks fail on geometry.
    await dialog
      .getByRole('button', { name: 'Create Sprint' })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    // The planner lands on the new sprint with per-team capacity seeded.
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText('One S2');
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).toBeVisible();

    if (hasAdminRest) {
      // The sprint exists NATIVELY on the real board — not only in app state.
      const sprints = await boardSprints(PROJECTS.one.boardId);
      expect(sprints.map((s) => s.name)).toContain('One S2');
    }
  });

  test('sprint selector switches between managed sprints', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const popup = await openRingSelect(frame, 'Select a Sprint');
    await expect(popup).toContainText('One S1');
    await expect(popup).toContainText('One S2');
    await popup.getByText('One S1', { exact: true }).click();
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText('One S1');
  });
});
