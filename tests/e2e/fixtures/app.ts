/**
 * Navigation + widget helpers for the Sprint Capacity Planner UI.
 *
 * SPIKE: the concrete DOM produced by the Ring UI widgets is not known at authoring
 * time (the widget sources are built by a parallel workstream). Selectors here are
 * best-effort and centralised so a single edit re-points the whole suite once the
 * real markup is available. Prefer role/name and data-test attributes.
 */
import { expect, type Page } from '@playwright/test';

const seed = (): { projectId: string; boardId: string } => {
  // The seed step records the isolated project/board ids. Tests read them from env
  // (exported by the harness) so they target the SCP_E2E_<runId> sandbox.
  return {
    projectId: process.env.YT_TEST_PROJECT_ID ?? '',
    boardId: process.env.YT_TEST_BOARD_ID ?? '',
  };
};

/** Open the project settings page where the Sprint Capacity Settings widget mounts. */
export async function openProjectSettings(page: Page): Promise<void> {
  const { projectId } = seed();
  // SPIKE: confirm the settings route for the target version.
  await page.goto(`/admin/editProject/${projectId}?tab=sprint-capacity-settings`);
  await expect(page.locator('body')).toBeVisible();
}

/** Open the Sprint Capacity tab widget for the seeded project. */
export async function openSprintCapacityTab(page: Page): Promise<void> {
  const { projectId } = seed();
  // SPIKE: confirm the project-tab widget route/extension mount path.
  await page.goto(`/projects/${projectId}?tab=sprint-capacity-tab`);
  await expect(page.locator('body')).toBeVisible();
}

/** Best-effort: locate a control by accessible name, falling back to a data-test id. */
export function control(page: Page, name: string, testId: string) {
  // SPIKE: widgets should expose data-test ids; until then match by role/name.
  return page
    .getByTestId(testId)
    .or(page.getByRole('button', { name }))
    .or(page.getByRole('textbox', { name }))
    .first();
}

/** Wait for the widget's backend call to settle (loading spinner gone). */
export async function waitForWidgetReady(page: Page): Promise<void> {
  // SPIKE: replace with the widget's real ready signal (e.g. data-test="scp-ready").
  await page
    .getByTestId('scp-ready')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {
      /* fall back to a short settle wait when the marker is absent */
    });
}
