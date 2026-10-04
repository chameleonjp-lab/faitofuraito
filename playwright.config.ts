import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests', timeout: 60000, expect: { timeout: 15000 }, workers: 1, retries: 0,
  projects: [
    { name:'webkit-ui', testMatch:/settings-webkit\.spec\.ts/, use:{browserName:'webkit',launchOptions:{}} },
    { name:'chromium', use:{browserName:'chromium'} },
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4177', viewport: { width:393,height:852 }, isMobile:true,hasTouch:true,
    screenshot:'only-on-failure',trace:'retain-on-failure',
    launchOptions: { args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] } },
  webServer: { command:'npm run dev -- --host 127.0.0.1 --port 4177', url:'http://127.0.0.1:4177',reuseExistingServer:!process.env.CI },
});
