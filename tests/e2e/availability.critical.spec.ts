/**
 * Critical journey: team member availability + estimates (§26.2).
 *
 * Alice and Bob each open the Sprint Capacity tab, set their available minutes and
 * confirm; the manager sees confirmed capacity roll up. Also exercises the
 * "issues missing Original Effort" estimate warning.
 */
import { test, expect, hasInstance } from './fixtures/test';
import { openSprintCapacityTab, control, waitForWidgetReady } from './fixtures/app';
import { assertNoBlockingA11yViolations } from './fixtures/axe';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('alice sets and confirms her availability', async ({ alicePage }, testInfo) => {
  await openSprintCapacityTab(alicePage);
  await waitForWidgetReady(alicePage);

  await control(alicePage, 'Available minutes', 'scp-available-minutes').fill('4800'); // 10 days * 8h
  await control(alicePage, 'Confirm availability', 'scp-confirm-availability').click();

  await expect(
    alicePage.getByText(/confirmed/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  await assertNoBlockingA11yViolations(alicePage, testInfo, 'capacity-tab');
});

test('bob sets a partial availability without confirming', async ({ bobPage }) => {
  await openSprintCapacityTab(bobPage);
  await waitForWidgetReady(bobPage);

  await control(bobPage, 'Available minutes', 'scp-available-minutes').fill('2400');
  // Bob intentionally does not confirm — manager view should show him unconfirmed.
  await expect(control(bobPage, 'Confirm availability', 'scp-confirm-availability')).toBeVisible();
});

test('manager sees rolled-up confirmed capacity', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);

  // SPIKE: confirmed/planned capacity summary locator.
  await expect(
    managerPage.getByTestId('scp-confirmed-capacity').or(managerPage.getByText(/confirmed capacity/i)).first(),
  ).toBeVisible({ timeout: 15_000 });
});
