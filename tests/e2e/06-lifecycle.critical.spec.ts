/**
 * Sprint lifecycle on a real board: "Create next Sprint" must create a NATIVE
 * YouTrack sprint on the TEAM's own board (verified over REST), register the team's
 * app state (seeded capacity) and select it in the planner — leaving the OTHER
 * team's board untouched (teams are fully separated since config v4). Runs late
 * (06-) because it permanently extends the managed history of project One.
 */
import { PROJECTS, openPlanner, openRingSelect, teamOf } from './fixtures/app';
import { boardSprints, hasAdminRest } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('sprint lifecycle', () => {
  test('create next sprint: preview, native sprint, team-scoped seeding', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    await frame.getByRole('button', { name: 'Create next Sprint' }).click();

    const dialog = frame.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The preview is computed from ALPHA's latest managed sprint and ALPHA's own
    // template: Alpha S1 → Alpha S2; the dialog names the team it creates for.
    await expect(dialog).toContainText('Alpha S2');
    await expect(dialog).toContainText('Create next Sprint — Alpha');
    await expect(dialog).toContainText("created on Alpha's board");
    // Programmatic click: the dialog centers within the tall auto-height iframe and
    // can sit outside the viewport where even force-clicks fail on geometry.
    await dialog
      .getByRole('button', { name: 'Create Sprint' })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    // The planner lands on the new sprint with the team's capacity seeded.
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText('Alpha S2');
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).toBeVisible();

    if (hasAdminRest) {
      // The sprint exists NATIVELY on ALPHA's real board — not only in app state —
      // and BETA's board (its own cadence, its own sprints) is untouched.
      const alphaSprints = await boardSprints(teamOf(PROJECTS.one, 'Alpha').boardId);
      expect(alphaSprints.map((s) => s.name)).toContain('Alpha S2');
      const betaSprints = await boardSprints(teamOf(PROJECTS.one, 'Beta').boardId);
      expect(betaSprints.map((s) => s.name)).not.toContain('Alpha S2');
    }
  });

  test('sprint selector lists only the selected team sprints', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const popup = await openRingSelect(frame, 'Select a Sprint');
    await expect(popup).toContainText('Alpha S1');
    await expect(popup).toContainText('Alpha S2');
    // Beta's sprint lives on Beta's board — never in Alpha's selector.
    await expect(popup).not.toContainText('Beta S1');
    await popup.getByText('Alpha S1', { exact: true }).click();
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText('Alpha S1');
  });
});
