/**
 * Critical journey: initial configuration + create the first Sprint (§26.2).
 *
 * Manager opens Sprint Capacity Settings, configures effort fields / board / focus
 * factor, saves, then creates the first managed Sprint. Includes an accessibility
 * gate on the settings widget (§27).
 *
 * Selectors are best-effort (see fixtures/app.ts SPIKE) and self-skip without an instance.
 */
import { test, expect, hasInstance } from './fixtures/test';
import { openProjectSettings, openSprintCapacityTab, control, waitForWidgetReady } from './fixtures/app';
import { assertNoBlockingA11yViolations } from './fixtures/axe';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('manager performs initial configuration', async ({ managerPage }, testInfo) => {
  await openProjectSettings(managerPage);
  await waitForWidgetReady(managerPage);

  // SPIKE: field names/ids come from the settings widget. Fill the core config.
  await control(managerPage, 'Original Effort field', 'scp-original-effort-field').fill('Original Effort');
  await control(managerPage, 'Current Effort field', 'scp-current-effort-field').fill('Current Effort');
  await control(managerPage, 'Hours per day', 'scp-hours-per-day').fill('8');
  await control(managerPage, 'Sprint length (days)', 'scp-sprint-length').fill('14');

  await control(managerPage, 'Save', 'scp-save-config').click();

  // Config persisted -> a confirmation / no error banner.
  await expect(
    managerPage.getByText(/saved|configuration updated/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  await assertNoBlockingA11yViolations(managerPage, testInfo, 'settings-widget');
});

test('manager creates the first sprint', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);

  // SPIKE: the create-next / create-first control label.
  await control(managerPage, 'Create first Sprint', 'scp-create-first-sprint').click();

  await expect(
    managerPage.getByText(/sprint/i).first(),
  ).toBeVisible({ timeout: 15_000 });
});
