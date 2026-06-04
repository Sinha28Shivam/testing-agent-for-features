import { test, expect } from '@playwright/test';

test('Navigation scenario for www.msn.com', async ({ page }) => {
  // Step 1: Navigate to the initial URL
  const url = 'https://www.msn.com/en-in';
  await page.goto(url);
  await expect(page).toHaveURL(/https:\/\/www\.msn\.com\/en-in\/?/);
  await expect(page).toHaveTitle(/MSN \| Personalized News, Top Headlines, Live Updates and more/);
  
  // Optional: Save a screenshot for documentation
  await page.screenshot({
    path: 'test-results/Performance_Testing/msn/homepage/initial_page_load.png',
  });

  // Step 2: Measure page load time
  let loadTime = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
  if (loadTime <= 0) {
    console.warn(`Invalid page load time detected: ${loadTime}ms. Reattempting navigation...`);
    
    // Step 3: Reload the page if the previous load time was invalid
    await page.goto(url);
    await expect(page).toHaveURL(/https:\/\/www\.msn\.com\/en-in\/?/);
    await expect(page).toHaveTitle(/MSN \| Personalized News, Top Headlines, Live Updates and more/);

    // Optional: Save another screenshot for documentation
    await page.screenshot({
      path: 'test-results/Performance_Testing/msn/homepage/reloaded_page.png',
    });

    // Step 4: Re-check the page load time
    loadTime = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
    expect(loadTime).toBeGreaterThan(0); // Ensure valid load time
    console.log(`Page load time (rechecked): ${loadTime}ms`);
  } else {
    console.log(`Page load time: ${loadTime}ms`);
  }

  // Optional: Save a final screenshot for documentation
  await page.screenshot({
    path: 'test-results/Performance_Testing/msn/homepage/final_page_state.png',
  });
});