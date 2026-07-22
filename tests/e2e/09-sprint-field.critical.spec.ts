/**
 * Enum Sprint-FIELD mirroring (SCPE2's team sets `sprintFieldName: 'Sprint'`):
 * teams that also track Sprints in an enum custom field must see it follow EVERY
 * planning move — backlog → Unassigned sets it to the Sprint's name, assigning to
 * a person keeps it, dragging back to the backlog clears it, and create-next's
 * carry-over rewrites it to the NEW Sprint. All verified over REST against the
 * REAL issue field, not the app's UI.
 */
import { PROJECTS, approveAppRequest, dragTo, openPlanner, teamOf } from './fixtures/app';
import { hasAdminRest, issueEnumField, issueEnumFieldBySummary } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');
test.skip(!hasAdminRest, 'requires YT_TEST_ADMIN_TOKEN (field values are verified over REST)');

const TWO = teamOf(PROJECTS.two, 'Team 1');

test.describe('sprint field mirroring', () => {
  test('seeded sprint issues carry the field; planning moves keep it in sync', async ({
    managerPage,
  }) => {
    const frame = await openPlanner(managerPage, PROJECTS.two.key);

    // The seeded in-sprint issue already mirrors the Sprint name.
    expect(await issueEnumFieldBySummary(PROJECTS.two.key, 'Two work A', 'Sprint')).toBe(
      TWO.sprintName,
    );

    // Backlog → Unassigned: joins the Sprint AND gets the field.
    const backlogCard = frame.locator(
      '[data-test="scp-lane-backlog"] [data-test="scp-card"][data-issue]',
      { hasText: 'Two backlog item' },
    );
    await expect(backlogCard).toBeVisible();
    const issueKey = (await backlogCard.getAttribute('data-issue'))!;
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${issueKey}"]`,
      '[aria-label="Lane Unassigned · in sprint"]',
    );
    await expect(
      frame.locator(`[aria-label="Lane Unassigned · in sprint"] [data-issue="${issueKey}"]`),
    ).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => issueEnumField(issueKey, 'Sprint'), { timeout: 20_000 }).toBe(
      TWO.sprintName,
    );

    // Unassigned → a person: still in the Sprint, field stays.
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${issueKey}"]`,
      '[aria-label="Lane Bob Jones"]',
    );
    await expect(
      frame.locator(`[aria-label="Lane Bob Jones"] [data-issue="${issueKey}"]`),
    ).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => issueEnumField(issueKey, 'Sprint'), { timeout: 20_000 }).toBe(
      TWO.sprintName,
    );

    // Back to the backlog: out of the Sprint, field CLEARED. (The remove is a
    // DELETE — approve the host's one-time consent prompt if it appears.)
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${issueKey}"]`,
      '[data-test="scp-lane-backlog"]',
    );
    await approveAppRequest(managerPage);
    await expect(
      frame.locator(`[data-test="scp-lane-backlog"] [data-issue="${issueKey}"]`),
    ).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => issueEnumField(issueKey, 'Sprint'), { timeout: 20_000 }).toBeNull();
  });

  test('create-next carry-over rewrites the field to the new Sprint', async ({ managerPage }) => {
    const frame = await openPlanner(managerPage, PROJECTS.two.key);
    // 'Two work A' is unresolved in the current Sprint — it will carry over.
    await frame.getByRole('button', { name: 'Create next Sprint' }).click();
    const dialog = frame.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('checkbox', { name: /Carry over/ })
      .evaluate((el) => (el as HTMLInputElement).click());
    await dialog
      .getByRole('button', { name: 'Create Sprint' })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    // The planner lands on the new Sprint; the carried issue's FIELD followed it.
    const newName = await frame
      .getByRole('combobox', { name: 'Select a Sprint' })
      .textContent();
    expect(newName).not.toBeNull();
    expect(newName).not.toBe(TWO.sprintName);
    await expect
      .poll(() => issueEnumFieldBySummary(PROJECTS.two.key, 'Two work A', 'Sprint'), {
        timeout: 20_000,
      })
      .toBe(newName!.trim());

    // RESTORE the seeded plan through the real UI (later specs expect the seeded
    // issues in Two S1) — which doubles as extra sync coverage: dropping to the
    // backlog clears the field, re-planning into Two S1 sets it back.
    for (const summary of ['Two work A', 'Two unassigned']) {
      const card = frame.locator('[data-test="scp-card"]', { hasText: summary }).first();
      const key = (await card.getAttribute('data-issue'))!;
      await dragTo(frame, `[data-test="scp-card"][data-issue="${key}"]`, '[data-test="scp-lane-backlog"]');
      await approveAppRequest(managerPage);
      await expect(
        frame.locator(`[data-test="scp-lane-backlog"] [data-issue="${key}"]`),
      ).toBeVisible({ timeout: 20_000 });
    }
    const popup = frame.locator('[data-test="ring-popup"]');
    await frame.getByRole('combobox', { name: 'Select a Sprint' }).click();
    await popup.getByText(TWO.sprintName, { exact: true }).click();
    // Assert on the COMBOBOX itself (popup text lingers in the DOM when hidden —
    // a body-wide assertion passes spuriously).
    await expect(frame.getByRole('combobox', { name: 'Select a Sprint' })).toContainText(
      TWO.sprintName,
      { timeout: 15_000 },
    );
    // Wait for the VIEW STATE to actually be Two S1 (the Details name reflects the
    // loaded sprint; the planner IGNORES drops while the view lags the selection),
    // then for its lists — the carried issues surface in ITS backlog pool.
    await expect(frame.getByRole('textbox', { name: 'Name' })).toHaveValue(TWO.sprintName, {
      timeout: 15_000,
    });
    await expect(frame.locator('[data-test="scp-lane-backlog"]')).toContainText('Two work A', {
      timeout: 20_000,
    });
    const workA = frame.locator('[data-test="scp-lane-backlog"] [data-test="scp-card"]', {
      hasText: 'Two work A',
    });
    const workAKey = (await workA.getAttribute('data-issue'))!;
    await dragTo(frame, `[data-test="scp-card"][data-issue="${workAKey}"]`, '[aria-label="Lane Bob Jones"]');
    await expect(frame.locator(`[aria-label="Lane Bob Jones"] [data-issue="${workAKey}"]`)).toBeVisible({
      timeout: 20_000,
    });
    const unass = frame.locator('[data-test="scp-lane-backlog"] [data-test="scp-card"]', {
      hasText: 'Two unassigned',
    });
    const unassKey = (await unass.getAttribute('data-issue'))!;
    await dragTo(
      frame,
      `[data-test="scp-card"][data-issue="${unassKey}"]`,
      '[aria-label="Lane Unassigned · in sprint"]',
    );
    await expect(
      frame.locator(`[aria-label="Lane Unassigned · in sprint"] [data-issue="${unassKey}"]`),
    ).toBeVisible({ timeout: 20_000 });
    // Round trip proven: the field is back on the ORIGINAL Sprint's name.
    await expect
      .poll(() => issueEnumFieldBySummary(PROJECTS.two.key, 'Two work A', 'Sprint'), {
        timeout: 20_000,
      })
      .toBe(TWO.sprintName);
  });
});
