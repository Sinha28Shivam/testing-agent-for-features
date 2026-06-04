import { test, expect } from '@playwright/test';

test('MSN Homepage Navigation and Screenshot', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure full loading of the page
  await expect(page).toHaveURL(/msn\.com\/en-in/); // Assert the URL with partial regex
  await expect(page).toHaveTitle(/^MSN/); // Assert the title with regex
  await expect(page.locator('body')).toBeVisible(); // Ensure the body is visible
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 }); // Wait for the first link to attach

  // Assert that key elements (like links or content) are present
  const linksCount = await page.locator('a').count();
  expect(linksCount).toBeGreaterThan(0); // Ensure there are links present on the page

  // Step 2: Take a screenshot of the homepage
  await page.screenshot({
    path: 'test-results/Smoke_Testing/msn/homepage/msn_homepage.png',
    fullPage: false,
  });
});