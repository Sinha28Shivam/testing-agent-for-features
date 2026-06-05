import { test, expect } from '@playwright/test';

test('MSN homepage performance testing and validation', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Wait for the page to fully load
  await expect(page).toHaveURL(/www\.msn\.com\/en-in/); // Assert partial URL match
  await expect(page).toHaveTitle(/^MSN/); // Assert the page title using regex
  await expect(page.locator('body')).toBeVisible(); // Verify the body is visible
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 }); // Ensure at least one link is attached

  // Step 2: Measure the page load time in the browser context
  const loadTime = await page.evaluate(() => {
    const timing = window.performance.timing;
    const loadEventEnd = timing.loadEventEnd > 0 ? timing.loadEventEnd : Date.now();
    return loadEventEnd - timing.navigationStart;
  });
  expect(loadTime).toBeGreaterThan(0); // Assert page load time is greater than 0ms
  expect(loadTime).toBeLessThan(60000); // Assert page load time is within a reasonable range

  // Step 3: Capture a performance screenshot of the main viewport
  await page.screenshot({
    path: 'test-results/Performance_Testing/msn/homepage/performance-screenshot.png',
    fullPage: false, // Capture only the viewport to avoid timeout issues
    type: 'png',
    scale: 'css'
  });

  // Additional validation: Ensure there are visible anchors or main interactive elements
  const linksCount = await page.locator('a').count();
  expect(linksCount).toBeGreaterThan(0); // Assert there is at least one link on the page
});