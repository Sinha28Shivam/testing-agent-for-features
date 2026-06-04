import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to https://www.msn.com/en-in...');
  try {
    await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (err) {
    console.log('Navigation timed out:', err.message);
  }

  const html = await page.content();
  await fs.writeFile(path.resolve('scratch/msn_page.html'), html, 'utf-8');
  console.log('Saved page content to scratch/msn_page.html');
  await browser.close();
}

run().catch(console.error);
