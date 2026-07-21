/**
 * Scope-change regression: metrics are computed on read, so an issue losing its
 * Original Effort must surface in the missing-effort warning without any manual
 * refresh (the planner polls every ~4s). Uses the real REST API to mutate the issue
 * and restores it afterwards.
 */
import { PROJECTS, openPlanner } from './fixtures/app';
import { hasAdminRest } from './fixtures/rest';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');
test.skip(!hasAdminRest, 'requires the admin REST token (YT_TEST_ADMIN_TOKEN)');

const base = (process.env.YT_TEST_BASE_URL ?? '').replace(/\/?$/, '/');
const token = process.env.YT_TEST_ADMIN_TOKEN ?? '';

/** Set (or clear, with null) the Original Effort period field over REST. */
async function setOriginalEffort(issueKey: string, minutes: number | null): Promise<void> {
  const res = await fetch(new URL(`api/issues/${issueKey}?fields=id`, base), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      customFields: [
        {
          name: 'Original Effort',
          $type: 'PeriodIssueCustomField',
          value: minutes === null ? null : { minutes },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`set Original Effort -> ${res.status}: ${await res.text()}`);
}

test('removing an estimate surfaces the missing-effort warning live', async ({ managerPage }) => {
  const frame = await openPlanner(managerPage, PROJECTS.two.key);
  // Baseline: the seeded project has no issues missing Original Effort.
  await expect(frame.locator('body')).not.toContainText(/missing Original Effort/i);

  const card = frame.locator('[data-test="scp-card"]', { hasText: 'Two work A' }).first();
  const issueKey = await card.getAttribute('data-issue');
  expect(issueKey).toBeTruthy();

  // Capture the current estimate so the restore is exact (period-day length is a
  // YouTrack-global setting, not the app's hoursPerDay).
  const before = await fetch(
    new URL(`api/issues/${issueKey}?fields=customFields(name,value(minutes))`, base),
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  ).then((r) => r.json() as Promise<{ customFields: Array<{ name: string; value: { minutes?: number } | null }> }>);
  const originalMinutes =
    before.customFields.find((f) => f.name === 'Original Effort')?.value?.minutes ?? null;
  expect(originalMinutes).not.toBeNull();

  try {
    await setOriginalEffort(issueKey!, null);
    // No refresh control exists — the 4s poll must pick the change up by itself.
    await expect(frame.locator('body')).toContainText(/1 Sprint issue missing Original Effort/i, {
      timeout: 20_000,
    });
  } finally {
    await setOriginalEffort(issueKey!, originalMinutes);
  }
  await expect(frame.locator('body')).not.toContainText(/missing Original Effort/i, {
    timeout: 20_000,
  });
});
