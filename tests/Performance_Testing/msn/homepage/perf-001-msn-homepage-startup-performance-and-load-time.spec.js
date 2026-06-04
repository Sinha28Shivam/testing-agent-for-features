import { test, expect } from '@playwright/test';

test('Navigation scenario on MSN with performance measurement', async ({ page }) => {
  // Step 1: Navigate to https://www.msn.com/en-in
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45000 });
  
  // Assert the URL to ensure we landed on the correct page
  await expect(page).toHaveURL(/msn\.com\/en-in\/?/);

  // Assert the title with a regex to account for variations
  await expect(page).toHaveTitle(/^MSN/);

  // Wait until a key element (e.g., heading or main article link) is visible
  await expect(page.getByRole('heading').first()).toBeVisible();

  // Step 2: Measure the page load time
  const initialLoadTime = await page.evaluate(() => 
    window.performance.timing.loadEventEnd - window.performance.timing.navigationStart
  );

  // Assert the initial load time is positive
  expect(initialLoadTime).toBeGreaterThan(0);
  expect(initialLoadTime).toBeLessThan(60000); // Arbitrary upper limit for realistic network performance

  // Step 3: Wait for 5 seconds to allow the page to fully settle
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Save a screenshot after waiting
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/after_wait_5_seconds.png' });

  // Step 4: Recheck the page load time
  const correctedLoadTime = await page.evaluate(() => 
    window.performance.timing.loadEventEnd - window.performance.timing.navigationStart
  );

  // Assert the corrected load time is within realistic bounds
  expect(correctedLoadTime).toBeGreaterThan(0);
  expect(correctedLoadTime).toBeLessThan(60000);

  // Save another screenshot after rechecking the load time
  await page.screenshot({ path: 'test-results/Performance_Testing/msn/homepage/corrected_screenshot.png' });
});