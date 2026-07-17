/**
 * Playwright globalSetup for the demo suite: build the widget bundles the harness serves,
 * so `playwright test --config playwright.demo.config.ts` always runs against fresh UI —
 * running the tests is enough to produce the demos.
 */
import { spawnSync } from 'node:child_process';

export default function globalSetup(): void {
  const res = spawnSync('node', ['scripts/build-widgets.mjs'], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`build-widgets failed with exit code ${res.status ?? 'unknown'}`);
  }
}
