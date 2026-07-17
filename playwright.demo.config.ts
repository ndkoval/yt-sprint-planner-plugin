/**
 * Playwright config for the DEMO / self-contained E2E suite: it drives the real widget
 * bundles against the real backend wired to an in-memory YouTrack (served by
 * scripts/serve-demo.mjs). This runs anywhere — no live YouTrack required — and records
 * video + trace + screenshots for every journey so the demos are captured as artifacts.
 *
 * Headless by default so it never steals focus while it runs (the equivalent of a
 * virtual display); every test uses its own isolated context which Playwright closes at
 * the end of the test.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.DEMO_PORT ?? 8090);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e/demo',
  outputDir: 'artifacts/demo/test-results',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/demo/playwright-report', open: 'never' }],
    ['json', { outputFile: 'artifacts/demo/report.json' }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve-demo.mjs',
    url: `${BASE_URL}/project-tab/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
