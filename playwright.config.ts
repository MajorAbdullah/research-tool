import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3060)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  // e2e touches a real SQLite file and a real job queue — serial keeps assertions meaningful.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // `channel: 'chromium'` runs the FULL Chromium build rather than the separate
    // chrome-headless-shell. Two reasons: the shell is an extra download that can be missing
    // even when Chromium itself installed fine (exactly what happened here), and the full
    // browser is closer to what a user actually runs.
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    // The board is drag-and-drop on Android and the PWA is the phone capture path,
    // so a mobile viewport is a first-class target, not an afterthought.
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chromium' } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm build && pnpm start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { SQLITE_PATH: './data/e2e.db', WORKER_ENABLED: 'true' },
      },
})
