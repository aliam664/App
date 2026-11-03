import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/security-browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5179',
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
    env: { PORT: '5179', HMR_PORT: '24679', UHM_DEV_INSTANCE: 'security-browser' },
    url: 'http://127.0.0.1:5179/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
