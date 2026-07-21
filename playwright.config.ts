/**
 * Playwright configuration for the Sprint Capacity Planner E2E suite (§28).
 *
 * - testDir: tests/e2e
 * - baseURL: process.env.YT_TEST_BASE_URL (the local YouTrack instance).
 * - The ENTIRE suite is skipped when YT_TEST_BASE_URL is unset (each spec also
 *   guards itself), so running without an instance reports all-skipped, not failed.
 * - Personas get separate storageState files (Manager / Alice / Bob / Unauthorized),
 *   materialised by the auth setup project before the persona projects run.
 * - "critical" journeys: video/trace/screenshot always on (§28.1).
 * - "regression" journeys: retain-on-failure only.
 * - Reports: HTML -> artifacts/playwright-report, JSON -> artifacts/playwright-report/report.json.
 * - outputDir (traces/videos/screenshots): artifacts/test-results.
 */
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const ARTIFACTS = path.join(process.cwd(), 'artifacts');
const STORAGE = path.join(ARTIFACTS, 'storage-state');
const baseURL = process.env.YT_TEST_BASE_URL || undefined;

/** Persona storage-state file paths, shared with the auth setup + fixtures. */
export const storageStatePaths = {
  manager: path.join(STORAGE, 'manager.json'),
  alice: path.join(STORAGE, 'alice.json'),
  bob: path.join(STORAGE, 'bob.json'),
  eve: path.join(STORAGE, 'eve.json'),
};

export default defineConfig({
  testDir: path.join('tests', 'e2e'),
  outputDir: path.join(ARTIFACTS, 'test-results'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(ARTIFACTS, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(ARTIFACTS, 'playwright-report', 'report.json') }],
  ],
  use: {
    baseURL,
    actionTimeout: 15_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    // Auth setup — logs each persona in and writes their storageState. Skips itself
    // (and thus leaves empty states) when there is no instance to authenticate against.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts$/,
    },
    // Critical journeys: full capture always on (§28.1).
    {
      name: 'critical',
      dependencies: ['setup'],
      testMatch: /.*\.critical\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        video: 'on',
        trace: 'on',
        screenshot: 'on',
      },
    },
    // Regression journeys: capture retained only on failure (§28.1).
    {
      name: 'regression',
      dependencies: ['setup'],
      testMatch: /.*\.regression\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
  ],
});
