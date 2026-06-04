import codeGenerator from '../src/agents/CodeGenerator.js';

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${label}`);
    passed++;
  } catch (e) {
    if (e.expected !== undefined) {
      console.log(`❌ FAIL: ${label}\n  ${e.message}`);
      failed++;
    } else {
      // re-throw unexpected errors
      throw e;
    }
  }
}

// ── Test 1: Exact title string should be CAUGHT ─────────────────────────────
const brittleTitle = `
import { test, expect } from '@playwright/test';
test('bad', async ({ page }) => {
  await expect(page).toHaveTitle('MSN | Personalized News, Top Headlines, Live');
});
`;
try {
  codeGenerator.brittleAssertionCheck(brittleTitle);
  console.log('❌ FAIL: Should have rejected exact toHaveTitle string');
  failed++;
} catch (e) {
  console.log('✅ PASS: Correctly rejected exact toHaveTitle string');
  passed++;
}

// ── Test 2: toBe(large number) should be CAUGHT ─────────────────────────────
const brittleTiming = `
import { test, expect } from '@playwright/test';
test('bad', async ({ page }) => {
  expect(loadTime).toBe(14446);
});
`;
try {
  codeGenerator.brittleAssertionCheck(brittleTiming);
  console.log('❌ FAIL: Should have rejected hardcoded toBe(14446)');
  failed++;
} catch (e) {
  console.log('✅ PASS: Correctly rejected hardcoded toBe(14446)');
  passed++;
}

// ── Test 3: innerText usage should be CAUGHT ─────────────────────────────────
const brittleInnerText = `
import { test, expect } from '@playwright/test';
test('bad', async ({ page }) => {
  const text = await page.evaluate(() => document.body.innerText.trim());
  expect(text.length).toBeGreaterThan(10);
});
`;
try {
  codeGenerator.brittleAssertionCheck(brittleInnerText);
  console.log('❌ FAIL: Should have rejected innerText usage');
  failed++;
} catch (e) {
  console.log('✅ PASS: Correctly rejected innerText usage');
  passed++;
}

// ── Test 4: Good spec with regex + range should PASS ────────────────────────
const goodCode = `
import { test, expect } from '@playwright/test';
test('good', async ({ page }) => {
  await page.goto('https://www.msn.com/en-in', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 45000 });
  await expect(page).toHaveTitle(/^MSN/);
  await expect(page).toHaveURL(/msn\\.com\\/en-in/);
  const t = await page.evaluate(() => performance.timing.loadEventEnd - performance.timing.navigationStart);
  expect(t).toBeGreaterThan(0);
  expect(t).toBeLessThan(60000);
  const len = await page.evaluate(() => document.body.innerHTML.length);
  expect(len).toBeGreaterThan(1000);
});
`;
try {
  codeGenerator.brittleAssertionCheck(goodCode);
  console.log('✅ PASS: Good spec correctly accepted');
  passed++;
} catch (e) {
  console.log('❌ FAIL: Good spec was wrongly rejected:', e.message.split('\n')[0]);
  failed++;
}

// ── Test 5: toHaveTitle with regex should PASS ───────────────────────────────
const goodTitle = `
import { test, expect } from '@playwright/test';
test('good', async ({ page }) => {
  await expect(page).toHaveTitle(/Welcome to/i);
});
`;
try {
  codeGenerator.brittleAssertionCheck(goodTitle);
  console.log('✅ PASS: Regex toHaveTitle correctly accepted');
  passed++;
} catch (e) {
  console.log('❌ FAIL: Regex toHaveTitle was wrongly rejected:', e.message.split('\n')[0]);
  failed++;
}

console.log(`\n─────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
