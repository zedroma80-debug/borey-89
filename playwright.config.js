import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100' + (process.env.BASE_PATH || '/borey-89/'), headless: true, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: {
    command: 'npm run preview -- --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100' + (process.env.BASE_PATH || '/borey-89/'),
    reuseExistingServer: false,
    timeout: 20000,
  },
});
