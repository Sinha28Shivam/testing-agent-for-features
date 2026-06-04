import { test, expect } from '@playwright/test';

test('MSN homepage load and performance test', async ({ page }) => {
  // Step 1: Navigate to the specified URL
  const url = 'https://www.msn.com/en-in';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure full page load
  
  // Assert that the correct URL is loaded
  await expect(page).toHaveURL(/www\.msn\.com\/en-in/);

  // Assert that the page title is as expected
  await expect(page).toHaveTitle(/^MSN/);

  // Assert that body is visible and main content is attached
  await expect(page.locator('body')).toBeVisible();
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
  expect(await page.locator('a').count()).toBeGreaterThan(0);

  // Step 2: Measure page load time using performance timing API
  const loadTime = await page.evaluate(() => {
    const timing = window.performance.timing;
    const loadEventEnd = timing.loadEventEnd > 0 ? timing.loadEventEnd : Date.now();
    return loadEventEnd - timing.navigationStart;
  });

  // Assert that the load time is within a reasonable range (e.g., 0 ms < loadTime < 60,000 ms)
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Save a screenshot of the loaded page for verification
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/navigation_success.png' });
});