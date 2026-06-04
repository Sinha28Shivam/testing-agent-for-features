import llmClient from '../core/LlmClient.js';

/**
 * CodeGenerator translates proven browser session logs into clean, executable Playwright test scripts.
 */
class CodeGenerator {
  async generate(actionLog) {
    console.log('[CodeGenerator] Converting browser session actions to Playwright test script...');
    const prompt = this.buildCodeGenPrompt(actionLog);
    const raw = await llmClient.ask(prompt);
    const code = this.extractCode(raw);
    this.brittleAssertionCheck(code);
    this.validateCode(code);
    return code;
  }

  buildCodeGenPrompt(log) {
    const stepsDescription = log.actions.map((a, i) => 
      `Step ${i + 1}: Called ${a.tool}(${JSON.stringify(a.args)})\nReason: ${a.reasoning || 'No reason'}\nResult: ${a.result || 'success'}`
    ).join('\n\n');

    const testDir = log.testDir || 'tests/generated';
    const screenshotDir = testDir.replace(/^tests/, 'test-results').replace(/\\/g, '/');

    return `You are converting a recorded browser session into a Playwright test script.

DOMAIN: ${log.domain}
SCENARIO: ${log.scenarioType}
TOTAL STEPS: ${log.totalSteps}
COMPLETED: ${log.completed ? 'true' : 'false'} (${log.completionReason || 'None'})

RECORDED BROWSER SESSION:
${stepsDescription}

INSTRUCTIONS:
1. Convert each recorded step into the equivalent Playwright action.
2. Use the same selectors and actions that were executed in the recorded browser session.
3. Add expect() assertions after each significant state change.
4. Use ES Modules: import { test, expect } from '@playwright/test';
5. Wrap all steps in a single test() block.
6. Use process.env for any credential values – NEVER hardcode them.
7. Output ONLY the code in a single \`\`\`javascript code block.
8. When asserting the URL using expect(page).toHaveURL(), use a simple partial regex (e.g. /domain\\.com\\/path/) rather than a strict full-URL match. Allow trailing slashes, hashes and query params so redirects never fail the assertion.
9. Do not use non-existent assertions like "toHaveCountGreaterThan". To check count bounds, use expect(await locator.count()).toBeGreaterThan(n) or await expect(locator).toHaveCount(n).
10. Save screenshots using page.screenshot({ path: '...' }). The screenshot path MUST be placed under the directory: "${screenshotDir}/" (using descriptive, clear names, e.g. "${screenshotDir}/search_results_page.png"). Always use forward slashes in screenshot paths. Prefer standard viewport screenshots (without fullPage: true) to avoid timeout issues on dynamic pages.
11. NEVER guess class names (e.g. '.news-article-selector') or data-automationid attributes (e.g. '[data-automationid="..."]') that were not explicitly proven to exist. Instead, use robust accessibility selectors like page.getByRole(), page.getByText(), or simple HTML tags like page.locator('img') or page.locator('footer').
12. If verifying that images load successfully, DO NOT assert that ALL images on the page have complete === true and naturalWidth > 0, as pages often contain tracking pixels, lazy-loaded images, or ads that do not render. Instead, write lenient assertions – for example, verify that at least one main image is visible and loaded successfully, or filter out tracking pixels/hidden/empty-src images before performing page-wide checks.

═══════════════════════════════════════════════════════════════
ASSERTION RULES — READ CAREFULLY BEFORE WRITING ANY expect():
═══════════════════════════════════════════════════════════════

13. TITLE ASSERTIONS — ALWAYS use regex, NEVER exact strings:
    ✅ CORRECT:  await expect(page).toHaveTitle(/^MSN/);
    ✅ CORRECT:  await expect(page).toHaveTitle(/Welcome to/i);
    ❌ WRONG:    await expect(page).toHaveTitle('MSN | Personalized News, Top Headlines, Live');
    Reason: Website titles change frequently. An exact match breaks on any wording update.

14. TIMING / PERFORMANCE ASSERTIONS — ALWAYS use range bounds, NEVER toBe():
    ✅ CORRECT:  expect(loadTime).toBeGreaterThan(0);
                 expect(loadTime).toBeLessThan(60000);
    ❌ WRONG:    expect(loadTime).toBe(14446);
    ❌ WRONG:    expect(loadTime).toEqual(14446);
    Reason: The exact millisecond from the recording session is a one-time measurement.
            Network speed varies on every run. toBe() on timing ALWAYS fails eventually.

15. COUNT ASSERTIONS — use range bounds when counting dynamic elements:
    ✅ CORRECT:  expect(await page.locator('article').count()).toBeGreaterThan(0);
    ❌ WRONG:    expect(await page.locator('article').count()).toBe(12);
    Reason: CMS-driven pages add/remove items dynamically.

16. SPA / REACT CONTENT — wait for networkidle before asserting content:
    ✅ CORRECT:  await page.goto(url, { waitUntil: 'domcontentloaded' });
                 await page.waitForLoadState('networkidle', { timeout: 45000 });
    ❌ WRONG:    await page.goto(url);
                 await expect(page.locator('main')).toBeVisible();  // may be empty SPA shell
    Reason: React/Angular/Vue pages render content after JS hydration, not at DOMContentLoaded.

17. CONTENT VISIBILITY ON SPAs — use innerHTML.length, NOT innerText.length:
    ✅ CORRECT:  const len = await page.evaluate(() => document.body.innerHTML.length);
                 expect(len).toBeGreaterThan(1000);
    ❌ WRONG:    const text = await page.evaluate(() => document.body.innerText.trim().length);
    Reason: innerText requires CSS layout computation which is unreliable in headless mode.

18. LOCATORS — avoid structural locators that assume specific HTML tag structure:
    ✅ CORRECT:  page.getByRole('heading')  OR  page.getByText(/News/i)
    ❌ WRONG:    page.locator('body > div > main > section')
    Reason: Any site redesign breaks deeply structural CSS selectors.

19. NEVER use toBe() or toEqual() on any value that was measured during the recording:
    - Page load times, network request durations, pixel dimensions, response sizes, timestamps.
    - These are one-time session measurements, not stable expected values.
    - Always substitute with toBeGreaterThan(lowerBound) + toBeLessThan(upperBound).

20. SCROLL POSITION / PIXEL VALUES — use approximate checks only:
    ✅ CORRECT:  expect(scrollY).toBeGreaterThan(0);
    ❌ WRONG:    expect(scrollY).toBe(342);

21. DYNAMIC TEXT CONTENT — use regex or toContain(), not exact strings:
    ✅ CORRECT:  await expect(element).toContainText(/welcome/i);
    ❌ WRONG:    await expect(element).toHaveText('Welcome back, Shivam!');
    Reason: User-specific or time-specific content changes between sessions.

22. NAVIGATION ASSERTIONS — always add waitForLoadState after clicks that navigate:
    ✅ CORRECT:  await page.click('a[href="/sports"]');
                 await page.waitForLoadState('domcontentloaded');
                 await expect(page).toHaveURL(/\\/sports/);

IMPORTANT: The actions above were actually executed against the real browser. Every selector and interaction is proven to work. Translate faithfully, but apply all Assertion Rules above to every expect() you write.`;

  }

  extractCode(rawResponse) {
    let cleanText = rawResponse.trim();
    
    // If it starts with markdown code block syntax
    if (cleanText.startsWith('```')) {
      const firstNewline = cleanText.indexOf('\n');
      if (firstNewline !== -1) {
        cleanText = cleanText.substring(firstNewline + 1);
      } else {
        cleanText = cleanText.replace(/^```(?:javascript|js)?/, '');
      }
    }
    
    // If it ends with markdown code block syntax
    if (cleanText.endsWith('```')) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    
    return cleanText.trim();
  }

  /**
   * Scans generated code for brittle assertion patterns that are guaranteed
   * to fail on subsequent runs (session-hardcoded values, exact strings, etc.).
   * Throws a descriptive error so the issue is caught before the file is written.
   */
  brittleAssertionCheck(code) {
    const lines = code.split('\n');
    const warnings = [];
    const errors = [];

    const brittlePatterns = [
      {
        // toHaveTitle('exact string') — titles change; must use regex
        re: /\.toHaveTitle\(\s*['"`][^/]/,
        message: 'toHaveTitle() uses an exact string. Use a regex instead: /^SiteName/ or /keyword/i'
      },
      {
        // toBe(<number>) on a measured value — timing/counts must use ranges
        re: /\.toBe\(\s*\d{3,}\s*\)/,
        message: 'toBe(<large-number>) detected. Measured values (timing, sizes) must use toBeGreaterThan()/toBeLessThan() ranges, never an exact value from the recording session.'
      },
      {
        // toEqual(<number>) — same issue as toBe for numbers
        re: /\.toEqual\(\s*\d{3,}\s*\)/,
        message: 'toEqual(<large-number>) detected. Use range assertions for any measured numeric value.'
      },
      {
        // innerText — unreliable in headless mode for SPAs
        re: /\.innerText(?!\w)/,
        message: 'innerText is unreliable in headless mode for SPAs. Use innerHTML.length or waitForLoadState("networkidle") instead.'
      },
      {
        // Very strict URL regex like /https:\/\/www\.exact\.com\/path\/?#?\/?$/
        re: /toHaveURL\(\s*\/https:\\\/\\\/www\\\..*\$\//,
        message: 'toHaveURL() regex is too strict (starts with https:\\/\\/ and ends with $). Use a simple partial regex like /domain\\.com\\/path/ instead.'
      },
      {
        // page.locator('main') alone — MSN and many SPAs do not use <main>
        re: /page\.locator\(\s*['"`]main['"`]\s*\)/,
        message: 'page.locator(\'main\') is fragile — many SPAs do not have a <main> element. Use page.waitForLoadState(\'networkidle\') and check innerHTML.length instead.'
      }
    ];

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // skip comments

      for (const { re, message } of brittlePatterns) {
        if (re.test(line)) {
          errors.push(`  Line ${lineNum}: ${message}\n    → ${line.trim()}`);
        }
      }
    });

    if (errors.length > 0) {
      const report = errors.join('\n\n');
      console.warn(`[CodeGenerator] ⚠️  Brittle assertion patterns detected in generated spec:\n${report}`);
      console.warn('[CodeGenerator] Retrying code generation with stricter emphasis on assertion rules...');
      // Throw so the orchestrator can decide to retry or skip
      throw new Error(
        `Generated spec contains ${errors.length} brittle assertion(s) that would fail on subsequent runs:\n${report}\n\nPlease regenerate with resilient assertions (regex, ranges, not session-recorded exact values).`
      );
    }
  }

  validateCode(code) {
    if (!code.includes('require(') && !code.includes('import ')) {
      throw new Error('Generated code is missing Playwright test imports');
    }
    if (!code.includes('test(')) {
      throw new Error('Generated code lacks a test() block');
    }
  }

}

const codeGenerator = new CodeGenerator();
export default codeGenerator;
