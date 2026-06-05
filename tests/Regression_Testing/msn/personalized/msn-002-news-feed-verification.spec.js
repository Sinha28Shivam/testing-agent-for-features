import { test, expect } from '@playwright/test';

test('MSN navigation and news feed verification', async ({ page }) => {
  // Step 1: Navigate to MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await expect(page).toHaveURL(/msn\.com\/en-in/);
  await expect(page).toHaveTitle(/^MSN/);

  // Step 2: Verify news feed section and capture snapshot
  const newsFeedLocator = page.getByText('Personalized News'); // Example selector for news feed section
  await newsFeedLocator.waitFor({ state: 'attached', timeout: 30000 });
  await expect(newsFeedLocator).toBeVisible();
  const articlesLocator = page.locator('article'); // Example selector for articles
  const articleCount = await articlesLocator.count();
  expect(articleCount).toBeGreaterThan(0); // Verify that articles are displayed
  await page.screenshot({
    path: 'test-results/Regression_Testing/msn/personalized/news_feed_snapshot.png'
  });

  // Step 3-6: Retry screenshot capturing viewport
  let screenshotPath = 'test-results/Regression_Testing/msn/personalized/news_feed_section.png';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: false
      });
      break; // If screenshot succeeds, exit loop
    } catch (err) {
      console.warn(`Screenshot attempt ${attempt} failed. Retrying...`);
      screenshotPath = `test-results/Regression_Testing/msn/personalized/news_feed_section_retry_${attempt}.png`;
    }
  }

  await page.screenshot({
    path: 'test-results/Regression_Testing/msn/personalized/news_feed_section_final.png',
    fullPage: false
  }); // Final attempt
});