import { test, expect } from '@playwright/test';

test('Navigation and screenshot capture of MSN homepage', async ({ page }) => {
  // Step 1: Navigate to the URL
  await page.goto('https://www.msn.com/en-in');
  
  // Assert that the correct URL is loaded, allowing trailing slashes or hashes
  await expect(page).toHaveURL(/https:\/\/www\.msn\.com\/en-in\/?#?/);

  // Wait for the main content of the homepage to be visible (e.g., header or body)
  await expect(page.locator('body')).toBeVisible();

  // Step 2: Take a screenshot of the homepage
  await page.screenshot({
    path: 'test-results/Smoke_Testing/msn/homepage/msn_homepage.png'
  });
});