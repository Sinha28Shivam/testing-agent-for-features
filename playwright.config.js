import { defineConfig } from '@playwright/test';

// Configure reporters based on REPORTER_TYPE env variable
const reporters = [['line']];
const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();

if (reporterType === 'allure') {
  const allureResultsDir = process.env.ALLURE_RESULTS_DIR || 'allure-results';
  reporters.push(['allure-playwright', { resultsDir: allureResultsDir }]);
} else if (reporterType === 'azure' || reporterType === 'junit') {
  reporters.push(['junit', { outputFile: 'test-results/junit/results.xml' }]);
} else {
  // Default to standard Playwright HTML report
  reporters.push(['html', { outputFolder: 'playwright-report', open: 'never' }]);
}

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: reporters,
  use: {
    headless: true,
    actionTimeout: 10000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
});
