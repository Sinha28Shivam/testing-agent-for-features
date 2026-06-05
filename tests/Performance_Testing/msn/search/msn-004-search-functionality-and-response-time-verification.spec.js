import { test, expect } from '@playwright/test';

test('MSN search functionality test', async ({ page }) => {
  // Step 1: Navigate to MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure the page has fully loaded
  await expect(page).toHaveURL(/www\.msn\.com\/en-in/); // Assert the URL contains the appropriate path
  await expect(page).toHaveTitle(/MSN/i); // Assert that the title contains "MSN"

  // Step 2: Perform a search for "Technology"
  const searchBox = page.getByRole('searchbox', { name: 'Enter your search term' });
  await expect(searchBox).toBeVisible(); // Verify that the search box is visible
  await searchBox.fill('Technology');
  await searchBox.press('Enter');
  await page.waitForLoadState('domcontentloaded'); // Wait for the search results to load
  await expect(page).toHaveURL(/bing\.com\/search\?q=Technology/); // Verify that the search redirects to Bing with the query "Technology"
  await expect(page).toHaveTitle(/Technology - Search/); // Assert the search page title includes "Technology"

  // Verify that some search results are loaded (lenient check)
  const searchResults = page.locator('li.b_algo'); // A typical Bing search result class
  await searchResults.first().waitFor({ state: 'visible', timeout: 30000 }); // Wait for at least one result to become visible
  expect(await searchResults.count()).toBeGreaterThan(0); // Assert at least one search result is present

  // Step 3: Take a screenshot of the search results page
  await page.screenshot({
    path: 'test-results/Performance_Testing/msn/search/search_results_page.png',
    fullPage: false,
  });
});