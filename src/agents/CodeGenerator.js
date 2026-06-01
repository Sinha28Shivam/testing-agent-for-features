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

    const finalSnapshot = log.actions[log.actions.length - 1]?.snapshotAfter || 'N/A';

    return `You are converting a recorded browser session into a Playwright test script.

DOMAIN: ${log.domain}
SCENARIO: ${log.scenarioType}
TOTAL STEPS: ${log.totalSteps}
COMPLETED: ${log.completed ? 'true' : 'false'} (${log.completionReason || 'None'})

RECORDED BROWSER SESSION:
${stepsDescription}

FINAL PAGE STATE (Accessibility Snapshot):
${finalSnapshot}

INSTRUCTIONS:
1. Convert each recorded step into the equivalent Playwright action.
2. Use ONLY getByRole(), getByLabel(), getByPlaceholder(), getByText() selectors.
3. These selectors come from the accessibility snapshot – they match the real DOM.
4. Add expect() assertions after each significant state change.
5. Use waitFor() for dynamic elements shown in the snapshots.
6. Use CommonJS: const { test, expect } = require('@playwright/test')
7. Wrap all steps in a single test() block.
8. Use process.env for any credential values – NEVER hardcode them.
9. Output ONLY the code in a single \`\`\`javascript code block.

IMPORTANT: The actions above were actually executed against the real browser. Every selector and interaction is proven to work. Translate faithfully.`;
  }

  extractCode(rawResponse) {
    let cleanText = rawResponse;
    if (cleanText.includes('```')) {
      const match = cleanText.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/);
      if (match) {
        cleanText = match[1];
      }
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
