import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure reporters based on REPORTER_TYPE env variable
const reporters = [['line']];
const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();

if (reporterType === 'allure') {
  // Use an absolute path so that allure-playwright always writes results to the
  // same directory regardless of the process working directory.
  const allureResultsDir = path.resolve(
    __dirname,
    process.env.ALLURE_RESULTS_DIR || 'allure-results'
  );
  reporters.push(['allure-playwright', { resultsDir: allureResultsDir }]);
} else if (reporterType === 'azure' || reporterType === 'junit') {
  reporters.push(['junit', { outputFile: 'test-results/junit/results.xml' }]);
} else {
  // Default to standard Playwright HTML report
  reporters.push(['html', { outputFolder: 'playwright-report', open: 'never' }]);
}

export default defineConfig({
  testDir: './tests',
  // 60 s per test — enough headroom for slow external sites (MSN, etc.)
  timeout: 60000,
  expect: {
    // Give expect() assertions up to 10 s before failing
    timeout: 10000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: reporters,
  use: {
    headless: true,
    // Give individual actions (click, fill, …) up to 15 s
    actionTimeout: 15000,
    // Give page.goto() up to 45 s before failing
    navigationTimeout: 45000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
});
