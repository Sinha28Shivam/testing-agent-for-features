import { test, expect } from '@playwright/test';

test('Navigation scenario: Verify www.msn.com page load with performance testing', async ({ page }) => {
  // Step 1: Navigate to the website
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensures all required resources are loaded
  
  // Assert URL to confirm successful navigation
  await expect(page).toHaveURL(/msn\.com\/en-in/);

  // Assert page title using regex
  await expect(page).toHaveTitle(/^MSN/);

  // Take a screenshot for navigation verification
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/navigation_successful.png' });

  // Step 2: Measure page load time using performance.timing (first attempt)
  let loadTime = await page.evaluate(() => {
    const timing = window.performance.timing;
    return timing.loadEventEnd - timing.navigationStart;
  });

  // Assert that the measured load time is valid (fallback for invalid result)
  if (loadTime <= 0) {
    loadTime = await page.evaluate(() => {
      const timing = window.performance.timing;
      const now = Date.now();
      return timing.loadEventEnd > 0 ? timing.loadEventEnd - timing.navigationStart : now - timing.navigationStart;
    });
  }
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Step 3: Recheck load time with a more robust fallback logic
  const robustLoadTime = await page.evaluate(() => {
    const timing = window.performance.timing;
    return timing.loadEventEnd > 0 ? timing.loadEventEnd - timing.navigationStart : -1;
  });

  // Assert robust load time measurement
  expect(robustLoadTime).toBeGreaterThan(0);
  expect(robustLoadTime).toBeLessThan(60000);

  // Take screenshot to log performance measurement success
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/performance_measurement_success.png' });

  // Additional assertions to ensure page has loaded relevant content
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 }); // Ensures important content is attached
  const linksCount = await page.locator('a').count();
  expect(linksCount).toBeGreaterThan(0); // At least one link should exist on the page
  
  // Ensure the body is visible as part of successful page load
  await expect(page.locator('body')).toBeVisible();
});