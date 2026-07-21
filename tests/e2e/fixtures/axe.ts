/**
 * Accessibility helper (§27): runs axe-core against the current page and asserts
 * there are no blocking (serious/critical) violations INSIDE THE APP'S WIDGET FRAME.
 *
 * Uses @axe-core/playwright. The scan covers the whole page, but only violations
 * whose nodes live inside an iframe gate the test: the widget is all we ship —
 * YouTrack's own chrome (untitled host iframes, sidebar avatars without alt text)
 * is not ours to fix. Non-blocking (minor/moderate) issues are logged as a warning,
 * and the full report (host page included) is attached for inspection.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

/** Axe encodes in-frame nodes as [frameSelector, innerSelector, ...] target chains. */
function insideFrame(violation: { nodes: Array<{ target: unknown[] }> }): boolean {
  return violation.nodes.some((n) => Array.isArray(n.target) && n.target.length > 1);
}

export async function assertNoBlockingA11yViolations(
  page: Page,
  testInfo: TestInfo,
  context?: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blocking = results.violations.filter(
    (v) => BLOCKING_IMPACTS.has(v.impact ?? '') && insideFrame(v),
  );
  const nonBlocking = results.violations.filter(
    (v) => !(BLOCKING_IMPACTS.has(v.impact ?? '') && insideFrame(v)),
  );

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
