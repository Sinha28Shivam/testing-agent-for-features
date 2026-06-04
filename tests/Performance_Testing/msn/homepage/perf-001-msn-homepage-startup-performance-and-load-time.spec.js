import { test, expect } from '@playwright/test';

test('MSN Homepage Navigation and Performance Testing', async ({ page }) => {
  // Step 1: Navigate to MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Wait for the page to fully load

  // Assert that the URL matches the expected pattern
  await expect(page).toHaveURL(/www\.msn\.com\/en-in/);

  // Assert that the page title matches the expected pattern
  await expect(page).toHaveTitle(/^MSN/);

  // Optional: Take a screenshot of the loaded page
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/homepage_loaded.png' });

  // Step 2: Measure page load time
  const loadTime = await page.evaluate(() => {
    const t = window.performance.timing;
    const end = t.loadEventEnd > 0 ? t.loadEventEnd : Date.now();
    return end - t.navigationStart;
  });

  // Assert that the load time is within a reasonable range
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Optional: Take a screenshot of the performance timing state, if needed
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/page_loaded_with_performance_metrics.png' });

  // Final assertions to ensure that the page has loaded successful content
  // Verify body is visible
  await expect(page.locator('body')).toBeVisible();

  // Wait for the first link or main content to be attached
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });

  // Assert there is at least one visible link on the page
  expect(await page.locator('a').count()).toBeGreaterThan(0);
});