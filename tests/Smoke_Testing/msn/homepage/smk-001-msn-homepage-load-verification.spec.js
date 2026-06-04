import { test, expect } from '@playwright/test';

test('MSN homepage navigation and branding verification', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });

  // Assert the URL to ensure navigation was successful
  await expect(page).toHaveURL(/www\.msn\.com\/en-in/);

  // Assert the title to ensure the page is loaded
  await expect(page).toHaveTitle(/^MSN/);

  // Assert that a key visible branding element is present (like a main navigation or logo link)
  await expect(page.locator('a[href*="msn.com"]').first()).toBeVisible();

  // Step 2: Take a screenshot of the page viewport
  await page.screenshot({ 
    path: 'test-results/Smoke_Testing/msn/homepage/msn_homepage.png',
    fullPage: false,
  });
});