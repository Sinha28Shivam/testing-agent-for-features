import { test, expect } from '@playwright/test';

test('navigation scenario', async ({ page }) => {
  // Step 1: Navigate to the TodoMVC demo page
  await page.goto('https://demo.playwright.dev/todomvc');
  await expect(page).toHaveURL(/.*todomvc.*/);
  await expect(page).toHaveTitle(/TodoMVC/);
  await page.screenshot({ path: 'test-results/Performance_Testing/playwright/homepage/todomvc_page.png' });

  // Step 2: Navigate to MSN's homepage
  await page.goto('https://www.msn.com/en-in');
  await expect(page).toHaveURL(/.*msn\.com\/en-in.*/);
  await expect(page).toHaveTitle(/MSN \| Personalized News, Top Headlines, Live Updates and more/);
  await page.screenshot({ path: 'test-results/Performance_Testing/playwright/homepage/msn_homepage.png' });
});