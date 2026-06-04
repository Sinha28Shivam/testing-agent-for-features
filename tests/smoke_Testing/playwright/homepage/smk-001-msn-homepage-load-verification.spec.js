import { test, expect } from '@playwright/test';

test('Navigation and screenshot for MSN homepage', async ({ page }) => {
  // Step 1: Navigate to the Playwright demo TodoMVC page
  await page.goto('https://demo.playwright.dev/todomvc');
  await expect(page).toHaveURL(/.*todomvc.*/);

  // Step 2: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in');
  await expect(page).toHaveURL(/.*msn\.com\/en-in.*/);
  await expect(page).toHaveTitle('MSN | Personalized News, Top Headlines, Live Updates and more');

  // Step 3: Take a screenshot of the MSN homepage (viewport only)
  await page.screenshot({
    path: 'test-results/Smoke_Testing/playwright/homepage/msn-homepage.png',
    type: 'png',
    scale: 'css',
  });
});