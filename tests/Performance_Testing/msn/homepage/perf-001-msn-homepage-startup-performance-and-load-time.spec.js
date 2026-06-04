import { test, expect } from '@playwright/test';

test('Navigation test for MSN homepage', async ({ page }) => {
  // Step 1: Navigate to the specified URL and verify the navigation
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/msn\.com\/en-in/);
  await expect(page).toHaveTitle(/^MSN/);

  // Take a screenshot of the homepage
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/homepage_loaded.png' });

  // Step 2: Evaluate if the page has finished loading and measure the page load time
  const { isLoadingComplete, loadTime } = await page.evaluate(() => ({
    isLoadingComplete: document.readyState === 'complete',
    loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart
  }));

  // Assert page load state and the measured load time
  expect(isLoadingComplete).toBe(true);
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Take a screenshot post-load evaluation
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/page_load_evaluation.png' });
});