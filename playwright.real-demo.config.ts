/**
 * Playwright config for the REAL-YouTrack demo suite. Unlike the self-contained mock demo
 * suite, this drives the app installed inside a real, running YouTrack (Docker 2025.3): the
 * actual app widgets (in their iframe) and the native Kanban board. Global setup provisions
 * the instance and saves an authenticated admin session; every journey records a 720p video.
 */
import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './tests/e2e/real-demo/global-setup';

// Real-demo reels write their WebVTT subtitles into the real-demo artifacts tree.
process.env.SCP_SUBTITLES_DIR ??= 'artifacts/real-demo/subtitles';

const BASE_URL = process.env.YT_TEST_BASE_URL ?? 'http://localhost:8080';
const VIEWPORT = { width: 1280, height: 720 };

export default defineConfig({
  testDir: 'tests/e2e/real-demo',
  outputDir: 'artifacts/real-demo/test-results',
  globalSetup: './tests/e2e/real-demo/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/real-demo/playwright-report', open: 'never' }]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    storageState: STORAGE_STATE,
    launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO_MS ?? 120) },
    video: { mode: 'on', size: VIEWPORT },
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } }],
});
