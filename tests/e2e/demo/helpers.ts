/**
 * Shared helpers for the demo E2E suite: persona navigation, accessibility scan, and a
 * console/page-error guard so every journey also asserts the UI is clean.
 */
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export type Persona = 'manager' | 'alice' | 'bob' | 'charlie';

const PROJECT = 'proj-demo';

/**
 * Shared `test` for the demo suite. An auto-fixture resets the harness world to the exact
 * seeded baseline before every test (across all files), so the suite is fully
 * deterministic and independent of run order. Import `test`/`expect` from here.
 */
export const test = base.extend<{ freshWorld: void }>({
  freshWorld: [
    async ({ request }, use) => {
      await request.post('/__demo/reset');
      await use();
    },
    { auto: true },
  ],
});
export { expect };

/** Open the project-tab widget as a persona and wait for the first data render. */
export async function openTab(page: Page, persona: Persona, sprintId?: string): Promise<void> {
  const sprintParam = sprintId ? `&sprint=${sprintId}` : '';
  await page.goto(`/project-tab/index.html?as=${persona}&projectId=${PROJECT}${sprintParam}`, {
    waitUntil: 'networkidle',
  });
  // The header title is always present once the app mounts.
  await expect(page.getByText('Sprint capacity', { exact: false }).first()).toBeVisible();
}

export const DEMO_PROJECT = PROJECT;

/**
 * Toggle a participant's "Confirmed" box. Ring UI wraps the real checkbox in a styled
 * label, so we click the enclosing label (a raw input .check() may not register).
 */
export async function toggleConfirm(page: Page, displayName: string): Promise<void> {
  const input = page.getByLabel(`Confirmed by ${displayName}`);
  await input.locator('xpath=ancestor::label[1]').click();
  await expect(input).toBeChecked({ timeout: 15_000 });
}

/** Open the project-settings widget as a persona. */
export async function openSettings(page: Page, persona: Persona): Promise<void> {
  await page.goto(`/project-settings/index.html?as=${persona}&projectId=${PROJECT}`, {
    waitUntil: 'networkidle',
  });
}

/** Attach a console/page-error collector; call the returned assert at the end. */
export function guardErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => {
    // Ignore benign favicon/network noise; fail on real app errors.
    const real = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
    expect(real, `unexpected console/page errors:\n${real.join('\n')}`).toHaveLength(0);
  };
}

/** Run an axe accessibility scan and fail on serious/critical violations. */
export async function assertAccessible(page: Page, info: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // color-contrast is intentionally not enforced in the standalone harness: the widget
    // inherits YouTrack's theme tokens (--ring-* variables) in production, which the
    // bare demo page does not provide, so contrast here is not representative. All
    // structural checks (labels, roles, names, keyboard) remain enforced.
    .disableRules(['color-contrast'])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  await info.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    blocking,
    `blocking a11y violations: ${blocking.map((v) => v.id).join(', ')}`,
  ).toHaveLength(0);
}
