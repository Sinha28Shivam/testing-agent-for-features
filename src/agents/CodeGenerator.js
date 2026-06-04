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
8. When asserting the URL using expect(page).toHaveURL(), derive the regular expression from the actual recorded URL and allow a trailing slash/hash so redirects do not fail the assertion.
9. Do not use non-existent assertions like "toHaveCountGreaterThan". To check count bounds, use expect(await locator.count()).toBeGreaterThan(n) or await expect(locator).toHaveCount(n).
10. Save screenshots using page.screenshot({ path: '...' }). The screenshot path MUST be placed under the directory: "${screenshotDir}/" (using descriptive, clear names, e.g. "${screenshotDir}/search_results_page.png"). Always use forward slashes in screenshot paths. Prefer standard viewport screenshots (without fullPage: true) to avoid timeout issues on dynamic pages.
11. NEVER guess class names (e.g. '.news-article-selector') or data-automationid attributes (e.g. '[data-automationid="..."]') that were not explicitly proven to exist. Instead, use robust accessibility selectors like page.getByRole(), page.getByText(), or simple HTML tags like page.locator('img') or page.locator('footer').
12. If verifying that images load successfully, DO NOT assert that ALL images on the page have complete === true and naturalWidth > 0, as pages often contain tracking pixels, lazy-loaded images, or ads that do not render. Instead, write lenient assertions – for example, verify that at least one main image is visible and loaded successfully, or filter out tracking pixels/hidden/empty-src images before performing page-wide checks.

IMPORTANT: The actions above were actually executed against the real browser. Every selector and interaction is proven to work. Translate faithfully.`;
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
