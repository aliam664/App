import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e', fullyParallel:false, workers:1,
  use:{baseURL:'http://127.0.0.1:5173',headless:true,trace:'retain-on-failure',launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']}:{}},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173/api/health',reuseExistingServer:!process.env.CI,timeout:30000},
});
