import { defineConfig, devices } from '@playwright/test';

const PORT = 8099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The E2E suite runs against the PRODUCTION artefact: the built client served
 * by the real game server, on one origin, exactly as it will be deployed.
 * Testing the dev server would test a thing nobody ships.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-portrait', use: { ...devices['Pixel 7'] } },
    {
      name: 'mobile-landscape',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 932, height: 430 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    command: 'npm run build && npm run start:e2e',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
