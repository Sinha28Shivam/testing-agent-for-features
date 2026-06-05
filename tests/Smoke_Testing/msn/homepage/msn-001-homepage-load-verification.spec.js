import { test, expect } from '@playwright/test';

test('MSN navigation test', async ({ page }) => {
  // Step 1: Navigate to the homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load'); // Ensure full page load
  await expect(page).toHaveURL(/msn\.com\/en-in/); // Verify the URL matches expected base domain

  // Step 2: Take a screenshot of the homepage
  await page.screenshot({ 
    path: 'test-results/Smoke_Testing/msn/homepage/homepage-mns.png' 
  });

  // Step 3: Verify the page title using regex
  await expect(page).toHaveTitle(/^MSN/);

  // Step 4: Validate the homepage sections (empty array expected from recording)
  const sectionTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('section')).map(section => section.textContent.trim()).filter(text => text.length > 0);
  });
  expect(sectionTexts.length).toBe(0);

  // Step 5: Click the 'DismissBanner' button if present
  const dismissButton = page.getByRole('button', { name: 'DismissBanner' });
  if (await dismissButton.isVisible()) {
    await dismissButton.click(); // Click the button to clear overlays
  }

  // Ensure the page remains attached and accessible
  await expect(page).toHaveURL(/msn\.com\/en-in/);
});