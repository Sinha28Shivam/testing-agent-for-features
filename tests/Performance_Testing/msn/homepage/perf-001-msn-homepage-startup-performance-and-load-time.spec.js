import { test, expect } from '@playwright/test';

test('Navigation and performance measurement on MSN homepage', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');

  // Assert the URL (partial match to allow flexibility like trailing slashes or query params)
  await expect(page).toHaveURL(/msn\.com\/en-in/);

  // Assert the title with a regex
  await expect(page).toHaveTitle(/^MSN/);

  // Assert that the body is visible and initial page content has successfully loaded
  await expect(page.locator('body')).toBeVisible();
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
  expect(await page.locator('a').count()).toBeGreaterThan(0);

  // Step 2: Measure page load time using performance timing
  const loadTime = await page.evaluate(() => {
    const t = window.performance.timing;
    const end = t.loadEventEnd > 0 ? t.loadEventEnd : Date.now();
    return end - t.navigationStart;
  });

  // Assert load time is within acceptable bounds (greater than 0 and less than 60 seconds)
  expect(loadTime).toBeGreaterThan(0);
  expect(loadTime).toBeLessThan(60000);

  // Step 3: Confirm the page’s loading state using a fallback for load event end timing
  const confirmedLoadTime = await page.evaluate(() => {
    const t = window.performance.timing;
    return (t.loadEventEnd > 0) ? (t.loadEventEnd - t.navigationStart) : null;
  });

  // Assert the confirmed load time matches the criteria
  expect(confirmedLoadTime).toBeGreaterThan(0);
  expect(confirmedLoadTime).toBeLessThan(60000);

  // Save a screenshot for verification purposes
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/navigation_test.png' });
});