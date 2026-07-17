/**
 * Critical journey: permissions + optimistic-concurrency conflict (§26.2).
 *
 * - An unauthorized user is denied the manager-only actions.
 * - Alice cannot edit Bob's availability.
 * - Two managers editing the same capacity revision produce a CAPACITY_REVISION_CONFLICT
 *   surfaced as a friendly "reload" prompt.
 */
import { test, expect, hasInstance } from './fixtures/test';
import { openProjectSettings, openSprintCapacityTab, control, waitForWidgetReady } from './fixtures/app';
import { personas } from './fixtures/personas';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('unauthorized user cannot access manager configuration', async ({ unauthorizedPage }) => {
  await openProjectSettings(unauthorizedPage);
  // SPIKE: denial surface — either a 403 view or the save control is absent/disabled.
  const save = control(unauthorizedPage, 'Save', 'scp-save-config');
  await expect(
    unauthorizedPage.getByText(/no permission|not allowed|forbidden/i).first().or(save),
  ).toBeVisible({ timeout: 15_000 });
  // If a save control is present it must be disabled for this persona.
  if (await save.isVisible().catch(() => false)) {
    await expect(save).toBeDisabled();
  }
});

test('alice cannot edit bob capacity', async ({ alicePage }) => {
  await openSprintCapacityTab(alicePage);
  await waitForWidgetReady(alicePage);
  // Alice's own row is editable; Bob's row must be read-only for her.
  const bobInput = alicePage.getByTestId('scp-capacity-row-bob').getByRole('textbox');
  if (await bobInput.first().isVisible().catch(() => false)) {
    await expect(bobInput.first()).toBeDisabled();
  }
});

test('concurrent capacity edits surface a revision conflict', async ({ managerPage, browser }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);

  // A second manager session loads the same (stale) revision.
  const second = await browser.newContext({ storageState: personas.manager.storageState });
  const secondPage = await second.newPage();
  await openSprintCapacityTab(secondPage);
  await waitForWidgetReady(secondPage);

  // First session saves — bumps the revision.
  await control(managerPage, 'Available minutes', 'scp-available-minutes').fill('4000');
  await control(managerPage, 'Save', 'scp-save-capacity').click();

  // Second session saves against the stale revision -> conflict prompt.
  await control(secondPage, 'Available minutes', 'scp-available-minutes').fill('3000');
  await control(secondPage, 'Save', 'scp-save-capacity').click();
  await expect(
    secondPage.getByText(/conflict|reload|out of date|changed since/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  await second.close();
});
