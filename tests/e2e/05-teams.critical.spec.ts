/**
 * Multi-team planning inside one project (SCPE1: Alpha + Beta), the heart of the
 * small-teams feature. Since config v4 the teams are FULLY separated: each owns its
 * board, cadence and settings, so the team switcher swaps the whole planning context
 * (sprint list included); teams plan independently (capacity edits and focus-factor
 * overrides in one team never move the other); single-team projects (SCPE2) see no
 * team chrome at all.
 */
import { PROJECTS, openPlanner, openRingSelect, openSettings, teamOf } from './fixtures/app';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

async function switchTeam(
  frame: Awaited<ReturnType<typeof openPlanner>>,
  name: string,
): Promise<void> {
  const popup = await openRingSelect(frame, 'Select a team');
  await popup.getByText(name, { exact: true }).click();
}

test.describe('teams', () => {
  test('team switcher swaps the whole planning context (board + sprints)', async ({
    managerPage,
  }) => {
    const alpha = teamOf(PROJECTS.one, 'Alpha');
    const beta = teamOf(PROJECTS.one, 'Beta');
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    // Default team is Alpha: its members are in the capacity table, Beta's are not,
    // and the selected Sprint is ALPHA's (each team has its own board since v4).
    await expect(frame.locator('[data-test="scp-team-select"]')).toBeVisible();
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText(alpha.sprintName);
    await expect(frame.locator('[data-test="scp-capacity-section"]')).toContainText('Capacity — Alpha');
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).toBeVisible();
    await expect(frame.getByLabel(/Available capacity in days for Bob/i)).toHaveCount(0);
    // Alpha's board: lanes for Alpha; work assigned to a non-member (bob) shows only
    // in the outside strip.
    await expect(frame.locator('[aria-label="Lane Alice Smith"]')).toBeVisible();
    await expect(frame.locator('[aria-label="Lane Bob Jones"]')).toHaveCount(0);
    await expect(frame.locator('[data-test="scp-outside-team"]')).toContainText('Assigned outside this team');
    await expect(frame.locator('[data-test="scp-fit-banner"]')).toContainText('Alpha:');

    // Switching teams lands on BETA's OWN board and sprint — a different context,
    // not a re-slice of the same sprint.
    await switchTeam(frame, 'Beta');
    await expect(frame.locator('[data-test="scp-ready"]')).toContainText(beta.sprintName);
    await expect(frame.locator('[data-test="scp-ready"]')).not.toContainText(alpha.sprintName);
    await expect(frame.locator('[data-test="scp-capacity-section"]')).toContainText('Capacity — Beta');
    await expect(frame.getByLabel(/Available capacity in days for Bob/i)).toBeVisible();
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).toHaveCount(0);
    await expect(frame.locator('[aria-label="Lane Bob Jones"]')).toContainText('Beta work A');
    await expect(frame.locator('[data-test="scp-fit-banner"]')).toContainText('Beta:');
  });

  test('teams plan independently: capacity and focus factor are per-team', async ({
    managerPage,
  }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);

    // Bob (Beta, 50% of Beta's OWN 7-day sprint = 2.5d default) gets a custom
    // availability.
    await switchTeam(frame, 'Beta');
    const bob = frame.getByLabel(/Available capacity in days for Bob/i);
    await bob.fill('4');
    await bob.blur();
    await managerPage.waitForTimeout(1500);

    // Beta's focus factor is overridden to 60%…
    await frame.getByRole('button', { name: 'Override focus factor' }).click();
    const dialog = frame.getByRole('dialog');
    await expect(dialog).toContainText('Override focus factor — Beta');
    await dialog.getByLabel(/New focus factor/i).fill('60');
    await dialog.getByLabel('Reason').fill('e2e: Beta runs interrupts this sprint');
    // Programmatic click: dialogs center within the tall auto-height iframe and can
    // sit outside the viewport where even force-clicks fail on geometry.
    await dialog
      .getByRole('button', { name: 'Apply override' })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(frame.locator('[data-test="scp-capacity-summary"]')).toContainText('60');

    // …while Alpha keeps its bootstrap 75% and its own capacity rows.
    await switchTeam(frame, 'Alpha');
    await expect(frame.locator('[data-test="scp-capacity-summary"]')).toContainText('75');
    await expect(frame.getByLabel(/Available capacity in days for Alice/i)).not.toHaveValue('4');

    // A fresh reload lands on the REMEMBERED team (Alpha was picked last — the
    // planner stores the choice per user in server-side prefs)…
    const reloaded = await openPlanner(managerPage, PROJECTS.one.key);
    await expect(reloaded.locator('[data-test="scp-capacity-section"]')).toContainText(
      'Capacity — Alpha',
    );
    // …and Beta still shows both changes (persisted server-side), leaving the
    // remembered team back on Alpha for later specs.
    await switchTeam(reloaded, 'Beta');
    await expect(reloaded.getByLabel(/Available capacity in days for Bob/i)).toHaveValue('4');
    await expect(reloaded.locator('[data-test="scp-capacity-summary"]')).toContainText('60');
    await switchTeam(reloaded, 'Alpha');
    await expect(reloaded.locator('[data-test="scp-capacity-section"]')).toContainText(
      'Capacity — Alpha',
    );
  });

  test('single-team project shows no team chrome', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.two.key);
    await expect(frame.locator('[data-test="scp-team-select"]')).toHaveCount(0);
    await expect(frame.locator('[data-test="scp-capacity-section"] h2')).toHaveText('Capacity');
    await expect(frame.locator('[data-test="scp-fit-banner"]')).not.toContainText('Team 1:');
  });

  test('teams are configured in settings: cards, shared members, add team', async ({
    managerPage,
  }) => {
    const frame = await openSettings(managerPage, PROJECTS.one.key);
    await expect(frame.locator('[data-test="scp-team-card"]')).toHaveCount(2);

    // Shared specialists: Bob (Beta) can ALSO join Alpha — the picker hints where
    // he already is but keeps him selectable.
    const alphaCard = frame.locator('[data-test="scp-team-card"][data-team="team-1"]');
    await alphaCard.getByRole('combobox', { name: 'Add a team member…' }).click();
    const pickerPopup = frame.locator('[data-test="ring-popup"]');
    await expect(pickerPopup.getByText(/Bob Jones.*also in Beta/)).toBeVisible();
    await pickerPopup.getByText(/Bob Jones.*also in Beta/).click();
    await expect(alphaCard.getByLabel(/Allocation for Bob Jones/i)).toBeVisible();

    // Add a third team too, then save everything at once.
    await frame.getByRole('button', { name: 'Add team', exact: true }).click();
    await expect(frame.locator('[data-test="scp-team-card"]')).toHaveCount(3);
    await frame.getByRole('button', { name: 'Save settings' }).click();
    await expect(frame.getByText('Settings saved.')).toBeVisible();
    await frame.getByRole('button', { name: '← Back to planner' }).click();
    await frame.locator('[data-test="scp-ready"]').waitFor({ state: 'visible' });

    // Roster changes are live IMMEDIATELY (no re-register): Bob has a capacity row
    // in Alpha now, and the new team is in the switcher.
    await expect(frame.locator('[data-test="scp-capacity-section"]')).toContainText('Capacity — Alpha');
    await expect(frame.getByLabel(/Available capacity in days for Bob/i)).toBeVisible();
    const teamsPopup = await openRingSelect(frame, 'Select a team');
    await expect(teamsPopup).toContainText('Team 3');
    await managerPage.keyboard.press('Escape');

    // Clean up: remove Bob from Alpha and drop the extra team (history is retained
    // server-side; later specs expect the two-team seed shape).
    const settings = await openSettings(managerPage, PROJECTS.one.key);
    const alphaAgain = settings.locator('[data-test="scp-team-card"][data-team="team-1"]');
    await alphaAgain
      .locator('tr', { hasText: 'Bob Jones' })
      .getByRole('button', { name: 'Remove' })
      .click();
    const thirdCard = settings.locator('[data-test="scp-team-card"]').nth(2);
    await thirdCard.getByRole('button', { name: 'Remove team' }).click();
    await expect(settings.locator('[data-test="scp-team-card"]')).toHaveCount(2);
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(settings.getByText('Settings saved.')).toBeVisible();
  });
});
