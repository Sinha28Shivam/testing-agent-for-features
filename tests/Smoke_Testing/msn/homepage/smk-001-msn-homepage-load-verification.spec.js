import { test, expect } from '@playwright/test';

test('MSN Homepage Navigation and Validation', async ({ page }) => {
  // Step 1: Navigate to MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure full page load
  
  // Assert that the URL is correct
  await expect(page).toHaveURL(/msn\.com\/en-in/);

  // Assert that the page title starts with "MSN"
  await expect(page).toHaveTitle(/^MSN/);

  // Assert that the main content or body is visible
  await expect(page.locator('body')).toBeVisible(); 
  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 }); // Wait for links to hydrate properly
  const linksCount = await page.locator('a').count();
  expect(linksCount).toBeGreaterThan(0); // Ensure there are links on the page
  
  // Step 2: Take a screenshot of the MSN homepage
  await page.screenshot({
    path: 'test-results/Smoke_Testing/msn/homepage/msn_homepage.png', 
    fullPage: false
  });
});