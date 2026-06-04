import llmClient from '../core/LlmClient.js';

/**
 * CodeGenerator translates proven browser session logs into clean, executable Playwright test scripts.
 */
class CodeGenerator {
  async generate(actionLog) {
    console.log('[CodeGenerator] Converting browser session actions to Playwright test script...');
    let prompt = this.buildCodeGenPrompt(actionLog);
    
    let attempts = 3;
    while (attempts > 0) {
      try {
        const raw = await llmClient.ask(prompt);
        const code = this.extractCode(raw);
        this.brittleAssertionCheck(code);
        this.validateCode(code);
        return code;
      } catch (err) {
        attempts--;
        if (attempts === 0) {
          throw err;
        }
        console.warn(`[CodeGenerator] Spec check failed. Retrying... (${attempts} attempts remaining)`);
        console.warn(`Error details: ${err.message}`);
        // Append the feedback to the prompt for the next attempt
        prompt = `${prompt}\n\n⚠️ PREVIOUS ATTEMPT FAILED WITH THE FOLLOWING BRITTLE ASSERTION/VALIDATION ERRORS:\n${err.message}\n\nPlease fix these issues and regenerate the code correctly.`;
      }
    }
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

14. TIMING / PERFORMANCE ASSERTIONS — ALWAYS use range bounds, NEVER toBe(). When measuring page load time in the page context, loadEventEnd might be 0 immediately after navigation. Use a fallback like Date.now() if loadEventEnd is not yet populated:
    ✅ CORRECT:  const loadTime = await page.evaluate(() => {
                   const t = window.performance.timing;
                   const end = t.loadEventEnd > 0 ? t.loadEventEnd : Date.now();
                   return end - t.navigationStart;
                 });
                 expect(loadTime).toBeGreaterThan(0);
                 expect(loadTime).toBeLessThan(60000);
    ❌ WRONG:    expect(loadTime).toBe(14446);
    Reason: The exact millisecond from the recording session is a one-time measurement.
            Network speed varies on every run. toBe() on timing ALWAYS fails eventually.

15. COUNT ASSERTIONS — use range bounds when counting dynamic elements:
    ✅ CORRECT:  expect(await page.locator('article').count()).toBeGreaterThan(0);
    ❌ WRONG:    expect(await page.locator('article').count()).toBe(12);
    Reason: CMS-driven pages add/remove items dynamically.

16. SPA / REACT CONTENT — wait for load state before asserting content:
    ✅ CORRECT:  await page.goto(url, { waitUntil: 'domcontentloaded' });
                 await page.waitForLoadState('load');
                 await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
    ❌ WRONG:    await page.goto(url);
                 await expect(page.locator('main')).toBeVisible();  // may be empty SPA shell
    Reason: React/Angular/Vue pages render content after JS hydration, not at DOMContentLoaded.
            Avoid waiting for 'networkidle' on pages with heavy tracking/telemetry (like MSN) as it will timeout.

17. CONTENT VISIBILITY ON SPAs / SHADOW DOM — avoid page.evaluate with document.body.innerHTML.length if the page uses Web Components / Shadow DOM (as shadow roots are not included in innerHTML). Instead, assert that a key locator (e.g. page.locator('a').first()) is visible.
    ✅ CORRECT:  await expect(page.locator('a').first()).toBeVisible();
    ❌ WRONG:    const len = await page.evaluate(() => document.body.innerHTML.length); // returns small number if elements are inside shadow roots.

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

23. DOM LOOKUPS / ELEMENT COUNT — NEVER use page.evaluate() with document.querySelector/querySelectorAll/getElementById/getElementsByTagName to count elements or assert their presence. Playwright locators automatically pierce Shadow DOM and support auto-waiting, whereas document API does not.
    ✅ CORRECT:  const linksCount = await page.locator('a').count();
                 expect(linksCount).toBeGreaterThan(0);
    ❌ WRONG:    const linksCount = await page.evaluate(() => document.querySelectorAll('a').length);

24. SHADOW DOM HYDRATION WAIT — Always wait for key locators (e.g. first link or first article) to become attached or visible before asserting element counts or verifying page content to prevent hydration race conditions. If elements can be hidden (like skip links), wait for state: 'attached'.
    ✅ CORRECT:  await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
                 const linksCount = await page.locator('a').count();
                 expect(linksCount).toBeGreaterThan(0);

25. BRANDING / LOGO ASSERTIONS — Avoid guessing specific logo image selectors or alt texts (like img[alt="MSN"] or img[alt="Microsoft News logo"]) as these are highly fragile. Instead, verify that the page has loaded successfully by asserting that the body is visible and checking that links or main content are attached/present (using Rule 24).
    ✅ CORRECT:  await expect(page.locator('body')).toBeVisible();
                 await page.locator('a').first().waitFor({ state: 'attached', timeout: 30000 });
                 expect(await page.locator('a').count()).toBeGreaterThan(0);
    ❌ WRONG:    await expect(page.locator('img[alt="Microsoft News logo"]')).toBeVisible();

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
      },
      {
        // document.querySelector / document.querySelectorAll / document.getElementById / document.getElementsByTagName inside page.evaluate()
        re: /page\.evaluate\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\))\s*\{?\s*(?:return\s+)?document\.(?:querySelector|querySelectorAll|getElementById|getElementsBy)/,
        message: 'Do not use document.querySelector/querySelectorAll/getElementById/getElementsByTagName inside page.evaluate() for DOM element checks or counts. Use Playwright native locators instead (e.g. page.locator()) to support Shadow DOM and auto-waiting.'
      },
      {
        // Guessing logo/branding image alt text
        re: /page\.locator\(\s*['"`]img\[alt=["'].*logo.*["']\]['"`]\s*\)/i,
        message: 'Avoid guessing image alt selectors containing "logo" (e.g., img[alt="...logo..."]). These are usually fragile guesses. Use page.locator(\'a[href*="domain"]\').first() or verify main page text/headers instead.'
      },
      {
        // toBeVisible() on page.locator('a').first()
        re: /expect\(\s*page\.locator\(\s*['"`]a.*['"`]\s*\)\.first\(\)\s*\)\.toBeVisible\(\)/,
        message: 'Do not use toBeVisible() on page.locator(\'a\').first() as the first link on many pages is a hidden skip link. Assert toBeAttached() instead, or target a specific visible element.'
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
