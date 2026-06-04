import { test, expect } from '@playwright/test';

test('Navigation and page load performance test for MSN homepage', async ({ page }) => {
  // Step 1: Navigate to the URL
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure the page has fully loaded.
  await expect(page).toHaveURL(/msn\.com\/en-in/); // Assert URL with a lenient regex.
  await expect(page).toHaveTitle(/^MSN/); // Assert the page's title.

  // Optional: Take a screenshot after navigation.
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/navigate_to_homepage.png' });

  // Step 2: Measure page load time
  const loadTime = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
  expect(loadTime).toBeGreaterThan(0); // Assert load time is positive.
  expect(loadTime).toBeLessThan(60000); // Assert load time is within acceptable range.

  // Optional: Log load time for debugging purposes.
  console.log(`Page load time: ${loadTime} ms`);

  // Optional: Take a screenshot after performance measurement.
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/page_load_verified.png' });
});