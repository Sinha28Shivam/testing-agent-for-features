import { test, expect } from '@playwright/test';

test('MSN homepage navigation and screenshot', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure the page is fully loaded

  // Assert the URL to confirm navigation
  await expect(page).toHaveURL(/msn\.com\/en-in/);

  // Assert the page title to confirm correct page load
  await expect(page).toHaveTitle(/^MSN/);

  // Check that the page loaded visible content (e.g., links, body tag visibility)
  await expect(page.locator('body')).toBeVisible();
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 }); // Ensure links are hydrated
  expect(await page.locator('a').count()).toBeGreaterThan(0);

  // Step 2: Capture a viewport screenshot
  await page.screenshot({
    path: 'test-results/Smoke_Testing/msn/homepage/msn-homepage.png',
  });
});