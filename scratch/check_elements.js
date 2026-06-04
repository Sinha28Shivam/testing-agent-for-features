import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log("Navigating to MSN...");
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  
  // Let's inspect some elements
  const bodyVisible = await page.locator('body').isVisible();
  const allLinksCount = await page.locator('a').count();
  const visibleLinksCount = await page.locator('a:visible').count();
  const headerVisible = await page.locator('header').isVisible();
  const h1Count = await page.locator('h1').count();
  const mainArticleCount = await page.locator('article').count();
  
  console.log("Body visible:", bodyVisible);
  console.log("Total links count:", allLinksCount);
  console.log("Visible links count:", visibleLinksCount);
  console.log("Header visible:", headerVisible);
  console.log("H1 elements count:", h1Count);
  console.log("Article elements count:", mainArticleCount);

  // Let's find some visible links
  const visibleLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => ({ href: a.href, text: a.innerText, visible: a.offsetWidth > 0 || a.offsetHeight > 0 }))
      .filter(x => x.visible)
      .slice(0, 5);
  });
  console.log("First 5 visible links in DOM context:", visibleLinks);

  await browser.close();
}

run().catch(console.error);
