import { test, expect } from '@playwright/test';

test('MSN navigation to Sports section', async ({ page, context }) => {
  // Step 1: Navigate to MSN homepage
  await page.goto('https://www.msn.com/en-in');
  await expect(page).toHaveURL(/.*msn\.com\/en-in.*/);
  await page.screenshot({ path: 'test-results/Regression_Testing/msn/general/homepage_loaded.png' });

  // Step 2: Click on the "Sports" link in the navigation menu
  const sportsLink = page.getByRole('link', { name: 'Sports' });
  await sportsLink.click();

  // Validate that a new tab is opened and contains the correct URL for the Sports section
  const [msnSportsPage] = await Promise.all([
    context.waitForEvent('page'), // Wait for the new tab to open
    // The click triggers this new tab
  ]);

  // Ensure the Sports page loads successfully
  await msnSportsPage.waitForLoadState('domcontentloaded');
  await expect(msnSportsPage).toHaveURL(/.*msn\.com\/en-in\/sports.*/);
  await msnSportsPage.screenshot({ path: 'test-results/Regression_Testing/msn/general/sports_page_loaded.png' });

  // Close the Sports page tab to clean up
  await msnSportsPage.close();
});