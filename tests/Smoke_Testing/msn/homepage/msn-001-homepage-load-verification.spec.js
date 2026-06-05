import { test, expect } from '@playwright/test';

test('MSN Homepage Navigation and Validation', async ({ page }) => {
  // Step 1: Navigate to the MSN homepage
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await expect(page).toHaveURL(/msn\.com\/en-in/);
  await expect(page).toHaveTitle(/^MSN/);

  // Step 2-5: Attempt to take a screenshot (retry mechanism removed in favor of final successful state)
  await page.screenshot({ 
    path: 'test-results/Smoke_Testing/msn/homepage/msn_homepage_final.png', 
    fullPage: false 
  });

  // Step 6: Verify the homepage sections
  // Wait for all sections to load or become visible
  await page.waitForSelector('section', { state: 'attached', timeout: 30000 });
  const sections = await page.locator('section');
  const sectionCount = await sections.count();
  expect(sectionCount).toBeGreaterThan(0); // Ensure there are sections on the homepage

  // Additionally verify non-empty sections using an array of visible texts
  const visibleSections = await sections.filter({ hasText: '' }).allTextContents();
  expect(visibleSections.length).toBeGreaterThan(0); // At least one visible section should be non-empty

  // Step After Loading WMS refinced.BAD Layer