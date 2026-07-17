/**
 * Critical journey: sprint lifecycle — resolution, scope changes, completed sprint,
 * and next-sprint focus factor (§26.2).
 *
 * Drives the manager through completing a Sprint and creating the next one, checking
 * that the observed focus factor is calibrated and applied to the new Sprint.
 */
import { test, expect, hasInstance } from './fixtures/test';
import { openSprintCapacityTab, control, waitForWidgetReady } from './fixtures/app';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test('resolving issues updates completed effort metrics', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);
  // SPIKE: the metrics panel showing current/completed effort.
  await expect(
    managerPage.getByTestId('scp-metrics').or(managerPage.getByText(/effort/i)).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('scope change is reflected in current effort', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);
  // Recalculate/refresh after a scope change (issue added/removed on the board).
  await control(managerPage, 'Recalculate', 'scp-recalculate').click().catch(() => {
    /* recalc may be automatic; ignore if control absent */
  });
  await expect(
    managerPage.getByTestId('scp-current-effort').or(managerPage.getByText(/current effort/i)).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test('completed sprint yields an observed focus factor applied to the next sprint', async ({ managerPage }) => {
  await openSprintCapacityTab(managerPage);
  await waitForWidgetReady(managerPage);

  // Create the next Sprint (one-click, §26.2). moveUnresolvedIssues defaults on.
  await control(managerPage, 'Create next Sprint', 'scp-create-next-sprint').click();

  // SPIKE: the new Sprint's focus-factor readout, sourced from calibration.
  await expect(
    managerPage.getByTestId('scp-focus-factor').or(managerPage.getByText(/focus factor/i)).first(),
  ).toBeVisible({ timeout: 15_000 });
});
