/**
 * Playwright config for the DEMO / self-contained E2E suite: it drives the real widget
 * bundles against the real backend wired to an in-memory YouTrack (served by
 * scripts/serve-demo.mjs). It runs anywhere — no live YouTrack required.
 *
 * Running the suite always PRODUCES the demos: globalSetup builds the widgets, every
 * journey records a crisp 720p video (with a visible cursor + human pacing — see
 * tests/e2e/demo/helpers.ts), and globalTeardown analyses the artifacts into
 * artifacts/demo/ui-analysis.md.
 *
 * Headless by default so it never steals focus while it runs; every test uses its own
 * isolated context which Playwright closes at the end.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.DEMO_PORT ?? 8090);
const BASE_URL = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1280, height: 720 };

export default defineConfig({
  testDir: 'tests/e2e/demo',
  outputDir: 'artifacts/demo/test-results',
  globalSetup: './tests/e2e/harness/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/demo/playwright-report', open: 'never' }],
    ['json', { outputFile: 'artifacts/demo/report.json' }],
  ],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // A little slowMo makes discrete actions (clicks, key presses) read naturally on video.
    launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO_MS ?? 120) },
    // Record a crisp video at the viewport resolution (not the scaled-down default).
    video: { mode: 'on', size: VIEWPORT },
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
  ],
  webServer: {
    command: 'node scripts/serve-demo.mjs',
    url: `${BASE_URL}/project-tab/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
