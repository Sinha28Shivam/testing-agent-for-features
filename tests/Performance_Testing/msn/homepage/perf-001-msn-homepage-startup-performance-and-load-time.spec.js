import { test, expect } from '@playwright/test';

test('MSN homepage navigation and performance testing', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  const url = 'https://www.msn.com/en-in';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45000 });

  // Assert the page URL using a regex pattern
  await expect(page).toHaveURL(/msn\.com/);

  // Assert the page title using a regex pattern
  await expect(page).toHaveTitle(/^MSN/);

  // Step 2: Measure the page load time using the performance API
  const loadTime = await page.evaluate(() => performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart);

  // Add assertions on loadTime to ensure reasonable range
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Take a screenshot for verification purposes
  await page.screenshot({
    path: 'test-results/Performance_Testing/msn/homepage/homepage_loaded.png'
  });

  // Optional: Assert dynamic content loaded successfully on the page (example: body HTML length)
  const bodyContentLength = await page.evaluate(() => document.body.innerHTML.length);
  expect(bodyContentLength).toBeGreaterThan(1000);
});