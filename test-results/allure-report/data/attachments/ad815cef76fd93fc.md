# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: Regression_Testing\msn\personalized\msn-002-news-feed-verification.spec.js >> MSN navigation and news feed verification
- Location: tests\Regression_Testing\msn\personalized\msn-002-news-feed-verification.spec.js:3:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
Call log:
  - waiting for getByText('Personalized News')

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('MSN navigation and news feed verification', async ({ page }) => {
  4  |   // Step 1: Navigate to MSN homepage
  5  |   await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  6  |   await page.waitForLoadState('load');
  7  |   await expect(page).toHaveURL(/msn\.com\/en-in/);
  8  |   await expect(page).toHaveTitle(/^MSN/);
  9  | 
  10 |   // Step 2: Verify news feed section and capture snapshot
  11 |   const newsFeedLocator = page.getByText('Personalized News'); // Example selector for news feed section
> 12 |   await newsFeedLocator.waitFor({ state: 'attached', timeout: 30000 });
     |                         ^ TimeoutError: locator.waitFor: Timeout 30000ms exceeded.
  13 |   await expect(newsFeedLocator).toBeVisible();
  14 |   const articlesLocator = page.locator('article'); // Example selector for articles
  15 |   const articleCount = await articlesLocator.count();
  16 |   expect(articleCount).toBeGreaterThan(0); // Verify that articles are displayed
  17 |   await page.screenshot({
  18 |     path: 'test-results/Regression_Testing/msn/personalized/news_feed_snapshot.png'
  19 |   });
  20 | 
  21 |   // Step 3-6: Retry screenshot capturing viewport
  22 |   let screenshotPath = 'test-results/Regression_Testing/msn/personalized/news_feed_section.png';
  23 |   for (let attempt = 1; attempt <= 3; attempt++) {
  24 |     try {
  25 |       await page.screenshot({
  26 |         path: screenshotPath,
  27 |         fullPage: false
  28 |       });
  29 |       break; // If screenshot succeeds, exit loop
  30 |     } catch (err) {
  31 |       console.warn(`Screenshot attempt ${attempt} failed. Retrying...`);
  32 |       screenshotPath = `test-results/Regression_Testing/msn/personalized/news_feed_section_retry_${attempt}.png`;
  33 |     }
  34 |   }
  35 | 
  36 |   await page.screenshot({
  37 |     path: 'test-results/Regression_Testing/msn/personalized/news_feed_section_final.png',
  38 |     fullPage: false
  39 |   }); // Final attempt
  40 | });
```