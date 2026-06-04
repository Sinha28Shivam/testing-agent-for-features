import { test, expect } from '@playwright/test';

test('www.msn.com - navigation scenario', async ({ page }) => {
  // Step 1: Navigate to the homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45000 }); // Ensure all resources are fully loaded
  await expect(page).toHaveURL(/msn\.com\/en-in/); // Assert URL pattern
  await expect(page).toHaveTitle(/^MSN/); // Assert title begins with "MSN"
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/navigation_complete.png' }); // Save screenshot

  // Step 2: Measure the page load time
  const loadTime = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
  expect(loadTime).toBeGreaterThan(0); // Assert load time is greater than 0 ms
  expect(loadTime).toBeLessThan(60000); // Assert load time is less than 60,000 ms
});