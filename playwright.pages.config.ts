import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/pages',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5181/App/',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
        }
      : {},
  },
  webServer: {
    command: 'npm run preview:pages',
    url: 'http://127.0.0.1:5181/App/',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
