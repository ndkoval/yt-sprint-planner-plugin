/**
 * Drag-and-drop planning against REAL YouTrack state: pulling a backlog issue onto a
 * teammate must add it to the NATIVE sprint and set the real Assignee (verified over
 * REST, not just in the app's UI); dragging back must remove it again. The spec
 * restores the initial state so later specs see the seeded plan.
 */
import { PROJECTS, approveAppRequest, dragTo, openPlanner } from './fixtures/app';
import { boardSprints, hasAdminRest, sprintIssues } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

test.describe('planning board', () => {
  test('backlog → lane assigns and joins the native sprint; back to backlog removes', async ({
    managerPage,
  }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const backlogCard = frame.locator(
      '[data-test="scp-lane-backlog"] [data-test="scp-card"][data-issue]',
      { hasText: 'Backlog item one' },
    );
    await expect(backlogCard).toBeVisible();
    const issueKey = await backlogCard.getAttribute('data-issue');

    // Drag the card onto Alice's lane: into the sprint + assigned in one move.
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${issueKey}"]`,
      '[data-test="scp-lane"][aria-label="Lane Alice Smith"]',
    );
    const aliceLane = frame.locator('[aria-label="Lane Alice Smith"]');
    await expect(aliceLane.locator(`[data-issue="${issueKey}"]`)).toBeVisible({ timeout: 20_000 });

    if (hasAdminRest) {
      // The REAL sprint gained the issue with the REAL assignee.
      const sprints = await boardSprints(PROJECTS.one.boardId);
      const sprint = sprints.find((s) => s.name === PROJECTS.one.sprintName);
      expect(sprint).toBeTruthy();
      const issues = await sprintIssues(PROJECTS.one.boardId, sprint!.id);
      const planned = issues.find((i) => i.idReadable === issueKey);
      expect(planned).toBeTruthy();
      expect(planned!.assignee).toBe('alice');
    }

    // Drag it back to the backlog: out of the sprint again. The remove is a DELETE,
    // which the host gates behind a one-time per-user consent prompt — approve it.
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${issueKey}"]`,
      '[data-test="scp-lane-backlog"]',
    );
    await approveAppRequest(managerPage);
    await expect(
      frame.locator(`[data-test="scp-lane-backlog"] [data-issue="${issueKey}"]`),
    ).toBeVisible({ timeout: 20_000 });

    if (hasAdminRest) {
      const sprints = await boardSprints(PROJECTS.one.boardId);
      const sprint = sprints.find((s) => s.name === PROJECTS.one.sprintName);
      const issues = await sprintIssues(PROJECTS.one.boardId, sprint!.id);
      expect(issues.find((i) => i.idReadable === issueKey)).toBeUndefined();
    }
  });

  test('board shows over/fit banner and unassigned lane', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    await expect(frame.locator('[data-test="scp-fit-banner"]')).toBeVisible();
    await expect(frame.locator('[aria-label="Lane Unassigned · in sprint"]')).toBeVisible();
    // The seeded shared unassigned work is on every team's board.
    await expect(
      frame.locator('[aria-label="Lane Unassigned · in sprint"]'),
    ).toContainText('Shared unassigned work');
  });

  test('issue overlay opens wide, anchored, with cross-team assignees', async ({
    managerPage,
  }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const card = frame.locator('[data-test="scp-card"]', { hasText: 'Alpha work A' }).first();
    await card.dblclick();
    const overlay = frame.locator('[data-test="scp-issue-overlay"]');
    await expect(overlay).toBeVisible();
    // WIDE panel (user-reported: the old host modal was ~600px and cramped) — it
    // must take essentially the whole widget width, up to its 1080px cap.
    const box = await overlay.boundingBox();
    const widgetWidth = await frame.evaluate(() => document.body.clientWidth);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(Math.min(1080, widgetWidth - 64));
    // The header id is a link to the native issue view (opens a new tab).
    await expect(frame.locator('[data-test="scp-issue-overlay-open-native"]')).toBeVisible();
    // Assignee is a native-looking inline select listing EVERY team's members —
    // Beta's bob is reachable from Alpha's board (the cross-team handoff path).
    // ACTUALLY CLICK an option (popups must stack above the panel — regression
    // guard: they once rendered behind it and clicks were intercepted).
    await frame.locator('[data-field="Assignee"]').getByRole('combobox').click();
    const popup = frame.locator('[data-test="ring-popup"]');
    await expect(popup).toContainText('Unassigned');
    await expect(popup).toContainText('Beta');
    // Programmatic clicks: the popup floats deep inside the tall auto-height iframe,
    // where Playwright's viewport-based actionability can't reach (same geometry as
    // the dialogs). The click itself still exercises the REAL option handler.
    await popup.getByText('Bob Jones').evaluate((el) => (el as HTMLElement).click());
    await expect(frame.locator('[data-field="Assignee"]').getByRole('combobox')).toContainText(
      'Bob Jones',
      { timeout: 20_000 },
    );
    // Hand it back to alice the same way (leaves the seed state intact).
    await frame.locator('[data-field="Assignee"]').getByRole('combobox').click();
    await popup.getByText('Alice Smith').evaluate((el) => (el as HTMLElement).click());
    await expect(frame.locator('[data-field="Assignee"]').getByRole('combobox')).toContainText(
      'Alice Smith',
      { timeout: 20_000 },
    );
    // Escape / close button / backdrop all close the overlay.
    await frame.locator('[data-test="scp-issue-overlay-close"]').click();
    await expect(overlay).not.toBeVisible();
  });

  test('the issue id on a card opens the native issue view in a new tab', async ({
    managerPage,
  }) => {
    const frame = await openPlanner(managerPage, PROJECTS.one.key);
    const idLink = frame.locator('[data-test="scp-card-id-link"]').first();
    const issueKey = await idLink.textContent();
    const [popupPage] = await Promise.all([
      managerPage.context().waitForEvent('page'),
      idLink.click(),
    ]);
    await popupPage.waitForLoadState('domcontentloaded');
    expect(popupPage.url()).toContain(`/issue/${issueKey}`);
    await popupPage.close();
  });
});
