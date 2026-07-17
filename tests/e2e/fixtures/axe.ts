/**
 * Accessibility helper (§27): runs axe-core against the current page and asserts
 * there are no blocking (serious/critical) violations.
 *
 * Uses @axe-core/playwright. Non-blocking (minor/moderate) issues are logged as a
 * warning but do not fail the test, so the gate matches the spec's "no blocking
 * violations" bar without being flaky on cosmetic findings.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

export async function assertNoBlockingA11yViolations(
  page: Page,
  testInfo: TestInfo,
  context?: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''));
  const nonBlocking = results.violations.filter((v) => !BLOCKING_IMPACTS.has(v.impact ?? ''));

  if (nonBlocking.length > 0) {
    console.warn(
      `[a11y]${context ? ` ${context}:` : ''} ${nonBlocking.length} non-blocking violation(s): ` +
        nonBlocking.map((v) => `${v.id}(${v.impact})`).join(', '),
    );
  }

  await testInfo.attach(`axe-${context ?? 'report'}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });

  expect(
    blocking,
    `Blocking accessibility violations${context ? ` in ${context}` : ''}: ` +
      blocking.map((v) => `${v.id} (${v.impact}) — ${v.help}`).join('; '),
  ).toEqual([]);
}
