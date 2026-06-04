import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

async function run() {
  console.log('Launching headless browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Navigating to https://www.msn.com/en-in...');
  try {
    await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log('Waiting for at least one link to be attached...');
    await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
    console.log('Link attached!');
  } catch (err) {
    console.log('Wait timed out:', err.message);
  }

  const jsCount = await page.evaluate(() => document.querySelectorAll('a').length);
  const pwCount = await page.locator('a').count();
  console.log(`document.querySelectorAll('a').length: ${jsCount}`);
  console.log(`page.locator('a').count(): ${pwCount}`);

  await browser.close();
}

run().catch(console.error);
