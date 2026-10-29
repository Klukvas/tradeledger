import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:5179',
    channel: 'chrome',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run server:build && node --import tsx e2e/runtime.mjs',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
