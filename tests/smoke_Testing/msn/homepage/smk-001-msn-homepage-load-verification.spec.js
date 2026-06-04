import { test, expect } from '@playwright/test';

test('MSN homepage navigation and interaction', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in');
  await expect(page).toHaveURL(/https:\/\/www\.msn\.com\/en-in\/?/);
  await expect(page).toHaveTitle(/MSN \| Personalized News, Top Headlines, Live Updates and more/);

  // Step 2: Take a screenshot of the homepage
  try {
    await page.screenshot({
      path: 'test-results/Smoke_Testing/msn/homepage/homepage_screenshot.png',
      fullPage: false,
    });
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    // If needed, a custom retry mechanism can be implemented here
  }

  // Step 3: Retake the screenshot in case the previous attempt timed out
  await page.screenshot({
    path: 'test-results/Smoke_Testing/msn/homepage/homepage_screenshot_retry.png',
    fullPage: false,
  });

  // Step 4: Dismiss the overlay banner if it exists
  const dismissBannerButton = page.getByRole('button', { name: 'DismissBanner' });
  if (await dismissBannerButton.isVisible()) {
    await dismissBannerButton.click();
    // Confirm overlay banner is no longer in view after clicking
    await expect(dismissBannerButton).not.toBeVisible();
  }
});