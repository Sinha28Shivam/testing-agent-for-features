import fs from 'fs/promises';
import { spawn } from 'child_process';
import messageBus, { EVENTS } from '../core/MessageBus.js';

class StaticAnalyzerAgent {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await messageBus.subscribe(EVENTS.STATIC_ANALYSIS_REQUESTED, async (payload) => {
      console.log(`[StaticAnalyzerAgent] Analyzing generated script statically: ${payload.scriptPath}`);
      try {
        const result = await this.analyze(payload);
        await messageBus.publish(EVENTS.STATIC_ANALYSIS_COMPLETE, result);
      } catch (err) {
        console.error('[StaticAnalyzerAgent Error] Analysis failed:', err);
        await messageBus.publish(EVENTS.STATIC_ANALYSIS_COMPLETE, {
          runId: payload.runId,
          domain: payload.domain,
          scriptPath: payload.scriptPath,
          validationScore: 0,
          passed: false,
          issues: [{ severity: 'blocking', message: `Static analysis crashed: ${err.message}` }]
        });
      }
    });

    this.initialized = true;
    console.log('[StaticAnalyzerAgent] Subscribed to analysis.static.requested.');
  }

  async analyze(payload) {
    const { runId, domain, scriptPath, targetUrl } = payload;
    const content = await fs.readFile(scriptPath, 'utf-8');
    
    const issues = [];
    let validationScore = 10;

    // 1. Syntax Check using node --check
    const syntaxOk = await this.checkSyntax(scriptPath);
    if (!syntaxOk) {
      issues.push({
        severity: 'blocking',
        type: 'syntax',
        message: 'JavaScript syntax error. Node failed to parse the file.'
      });
      validationScore = 0;
      return { runId, domain, scriptPath, validationScore, passed: false, issues };
    }

    // 2. Playwright Import check
    if (!content.includes('@playwright/test')) {
      issues.push({
        severity: 'blocking',
        type: 'imports',
        message: "Script does not import '@playwright/test'."
      });
      validationScore = 0;
    }

    // 3. Test & Expect block check
    if (!content.includes('test(')) {
      issues.push({
        severity: 'blocking',
        type: 'structure',
        message: "Script lacks a Playwright 'test(' definition."
      });
      validationScore = 0;
    }
    if (!content.includes('expect(')) {
      issues.push({
        severity: 'warning',
        type: 'structure',
        message: "Script does not contain any assertions ('expect(' statements)."
      });
      validationScore -= 2;
    }

    // 4. Hardcoded secrets check
    const secretKeywords = [/password\s*=\s*['"`][^'"`]{3,}/i, /secret\s*=\s*['"`][^'"`]{3,}/i, /key\s*=\s*['"`][^'"`]{3,}/i];
    for (const kw of secretKeywords) {
      if (kw.test(content)) {
        issues.push({
          severity: 'warning',
          type: 'security',
          message: "Potential hardcoded credential or secret detected."
        });
        validationScore -= 3;
        break;
      }
    }

    // 5. Anti-patterns (waitForTimeout)
    if (content.includes('waitForTimeout(')) {
      issues.push({
        severity: 'warning',
        type: 'anti-pattern',
        message: "Use of page.waitForTimeout() detected. Use explicit waits instead."
      });
      validationScore -= 1;
    }

    const passed = !issues.some(issue => issue.severity === 'blocking') && validationScore >= 5;

    console.log(`[StaticAnalyzerAgent] Completed analysis. Score: ${validationScore}/10, Passed: ${passed}, Issues: ${issues.length}`);
    return {
      runId,
      domain,
      scriptPath,
      validationScore: Math.max(0, validationScore),
      passed,
      issues
    };
  }

  checkSyntax(filePath) {
    return new Promise((resolve) => {
      const child = spawn('node', ['--check', filePath]);
      child.on('close', (code) => {
        resolve(code === 0);
      });
      child.on('error', () => {
        resolve(false);
      });
    });
  }
}

const staticAnalyzerAgent = new StaticAnalyzerAgent();
export default staticAnalyzerAgent;
