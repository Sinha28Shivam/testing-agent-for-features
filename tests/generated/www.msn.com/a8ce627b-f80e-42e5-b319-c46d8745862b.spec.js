import { test, expect } from '@playwright/test';

test('MSN homepage navigation and content verification', async ({ page }) => {
  // Step 1: Navigate to MSN India
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'networkidle' });
  await expect(page).toHaveTitle(/MSN/);

  // Step 2: Capture initial screenshot
  await page.screenshot({ path: '.playwright-mcp\\page-initial.png', type: 'png', scale: 'css' });

  // Step 3-5: Basic accessibility-driven checks: header link, search box, main region and Top stories link
  await expect(page.getByRole('link', { name: 'MSN' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByPlaceholder('Enter your search term')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  // "Top stories" appears as a link/heading in the snapshot
  await expect(page.getByRole('link', { name: 'Top stories' })).toBeVisible({ timeout: 10000 });

  // Step 6: Dismiss banner (recorded selector proved to work)
  const dismissBtn = page.getByRole('button', { name: 'DismissBanner' });
  if (await dismissBtn.count() > 0) {
    await dismissBtn.click();
    // Wait for banner to disappear/for main content to settle
    await expect(dismissBtn).toBeHidden({ timeout: 5000 }).catch(() => {}); // tolerant if already gone
  }

  // Step 7: Screenshot after dismissal
  await page.screenshot({ path: '.playwright-mcp\\page-after-dismiss.png', type: 'png', scale: 'css' });

  // Step 8: Re-check interactive page sections and some content items
  await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('link', { name: 'See more' })).toBeVisible({ timeout: 10000 });

  // Step 11: Wait for dynamic content to finish loading
  await page.waitForTimeout(5000);

  // Step 12: Scroll to load lazy content and wait briefly
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(2000);

  // Step 13: Screenshot after scrolling
  await page.screenshot({ path: '.playwright-mcp\\page-after-scroll.png', type: 'png', scale: 'css' });

  // Step 14: Verify title still contains MSN
  await expect(page).toHaveTitle(/MSN/);

  // Step 16: Click the 'MSN' header link to exercise navigation (recorded selector)
  await page.getByRole('link', { name: 'MSN' }).click();
  await expect(page).toHaveURL(/https:\/\/www\.msn\.com\/en-in/);
  await expect(page).toHaveTitle(/MSN/);

  // Final verification: key interactive controls visible and main content still accessible
  await expect(page.getByPlaceholder('Enter your search term')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('link', { name: 'Top stories' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('article').first()).toBeVisible({ timeout: 10000 });

  // Final screenshot
  await page.screenshot({ path: '.playwright-mcp\\page-final.png', type: 'png', scale: 'css' });
});