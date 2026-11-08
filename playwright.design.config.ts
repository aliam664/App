import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/design-browser',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
        }
      : {},
  },
  webServer: {
    command: 'npm run dev',
    env: { PORT: '5180', HMR_PORT: '24680', UHM_DEV_INSTANCE: 'design-browser' },
    url: 'http://127.0.0.1:5180/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
