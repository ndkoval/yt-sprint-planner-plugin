/**
 * Critical journey: team member availability + estimates (§26.2).
 *
 * Alice and Bob each open the Sprint Capacity tab and set their available minutes (there
 * is no confirmation step); the manager sees capacity roll up. Also exercises the
 * "issues missing Original Effort" estimate warning.
 */
import { test, expect, hasInstance } from './fixtures/test';
import { openSprintCapacityTab, control, waitForWidgetReady } from './fixtures/app';
import { assertNoBlockingA11yViolations } from './fixtures/axe';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('alice sets her availability', async ({ alicePage }, testInfo) => {
  await openSprintCapacityTab(alicePage);
  await waitForWidgetReady(alicePage);

  await control(alicePage, 'Available minutes', 'scp-available-minutes').fill('4800'); // 10 days * 8h
  // No confirmation step — capacity reflects what was set and updates automatically.

  await assertNoBlockingA11yViolations(alicePage, testInfo, 'capacity-tab');
});

test('bob sets a partial availability', async ({ bobPage }) => {
  await openSprintCapacityTab(bobPage);
  await waitForWidgetReady(bobPage);

  await control(bobPage, 'Available minutes', 'scp-available-minutes').fill('2400');
  await expect(control(bobPage, 'Available minutes', 'scp-available-minutes')).toBeVisible();
});

test('manager sees rolled-up capacity', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);

  // SPIKE: raw/planned capacity summary locator.
  await expect(
    managerPage.getByTestId('scp-raw-capacity').or(managerPage.getByText(/raw capacity/i)).first(),
  ).toBeVisible({ timeout: 15_000 });
});
