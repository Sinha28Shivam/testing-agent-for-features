import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import messageBus, { EVENTS } from '../core/MessageBus.js';
import memoryAgent from './MemoryAgent.js';
import llmClient from '../core/LlmClient.js';
import promptLoader from '../config/PromptLoader.js';

class RuntimeAnalyzerAgent {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await messageBus.subscribe(EVENTS.RUNTIME_ANALYSIS_REQUESTED, async (payload) => {
      console.log(`[RuntimeAnalyzerAgent] Executing playwright script: ${payload.scriptPath}`);
      try {
        const result = await this.executeAndAnalyze(payload);
        await messageBus.publish(EVENTS.TEST_EXECUTED, result);
      } catch (err) {
        console.error('[RuntimeAnalyzerAgent Error] Execution / Analysis failed:', err);
        await messageBus.publish(EVENTS.TEST_EXECUTED, {
          runId: payload.runId,
          domain: payload.domain,
          scriptPath: payload.scriptPath,
          success: false,
          error: err.message,
          isFixable: false
        });
      }
    });

    this.initialized = true;
    console.log('[RuntimeAnalyzerAgent] Subscribed to analysis.runtime.requested.');
  }

  async executeAndAnalyze(payload) {
    const { runId, domain, scenarioType, scriptPath } = payload;
    
    // 1. Execute Playwright test
    const { success, stdout, stderr, exitCode } = await this.runPlaywrightTest(scriptPath);
    console.log(`[RuntimeAnalyzerAgent] Script execution status: ${success ? 'PASSED' : 'FAILED'} (Exit code: ${exitCode})`);

    if (success) {
      // Record success in run_history
      await memoryAgent.connect();
      return {
        runId,
        domain,
        scenarioType,
        scriptPath,
        success: true,
        exitCode,
        duration: 0 // handled by parent
      };
    }

    // 2. Test failed, perform diagnostics
    console.log('[RuntimeAnalyzerAgent] Diagnostic stage started...');
    const scriptContent = await fs.readFile(scriptPath, 'utf-8');
    const combinedOutput = `${stdout}\n\n${stderr}`;

    // Extract exact error lines
    const errorSnippet = this.extractErrorSnippet(combinedOutput);
    
    // Classify error type (timeout, selector, navigation, assertion, network)
    let errorType = 'unknown';
    if (combinedOutput.includes('timeout') || combinedOutput.includes('Timeout')) {
      errorType = 'timeout';
    } else if (combinedOutput.includes('locator') || combinedOutput.includes('selector') || combinedOutput.includes('target') || combinedOutput.includes('element')) {
      errorType = 'selector';
    } else if (combinedOutput.includes('navigation') || combinedOutput.includes('goto')) {
      errorType = 'navigation';
    } else if (combinedOutput.includes('expect') || combinedOutput.includes('Assertion')) {
      errorType = 'assertion';
    } else if (combinedOutput.includes('network') || combinedOutput.includes('net::')) {
      errorType = 'network';
    }

    // Query MemoryAgent for known failure patterns
    await memoryAgent.connect();
    const domainPatterns = await memoryAgent.getPatternLibrary(scenarioType);
    
    // Check if any pattern matches the error text
    let matchedRule = null;
    for (const p of domainPatterns) {
      if (combinedOutput.toLowerCase().includes(p.pattern_key.toLowerCase()) || combinedOutput.toLowerCase().includes(p.description.toLowerCase())) {
        matchedRule = p.rule;
        console.log(`[RuntimeAnalyzerAgent] Found matching stored pattern rule: ${p.pattern_key}`);
        break;
      }
    }

    let fixRecommendation = '';
    let isFixable = true;

    if (matchedRule) {
      fixRecommendation = `Apply stored pattern rule: ${matchedRule}`;
    } else {
      // Load diagnostic prompt from YAML
      console.log('[RuntimeAnalyzerAgent] No stored pattern matched. Calling LLM to diagnose...');
      const promptTemplate = await promptLoader.getPrompt('runtime_analyzer', 'diagnose');
      const diagnosticPrompt = promptTemplate
        .replaceAll('{scriptPath}', scriptPath)
        .replaceAll('{scriptContent}', scriptContent)
        .replaceAll('{combinedOutput}', combinedOutput);

      try {
        const aiResponse = await llmClient.askJson(diagnosticPrompt);
        console.log('[RuntimeAnalyzerAgent] LLM diagnosis result:', aiResponse);
        
        fixRecommendation = aiResponse.recommendedFix || 'Regenerate the script with explicit assertions and longer timeouts.';
        isFixable = aiResponse.isFixable !== undefined ? aiResponse.isFixable : true;
        
        // Write the failure to failure log candidate (MemoryAgent will process this)
        await memoryAgent.writeFailureLog({
          runId,
          domain,
          scenarioType,
          testTitle: errorSnippet.substring(0, 100),
          errorType,
          errorMessage: errorSnippet,
          selectorUsed: aiResponse.failingSelector || null,
          fixAttempted: null,
          fixSucceeded: false,
          healingAttemptNumber: 1,
          coldStart: false
        });

      } catch (err) {
        console.error('[RuntimeAnalyzerAgent] LLM diagnostic call failed:', err.message);
        fixRecommendation = 'Syntax error or network failure during execution. Regenerate the script.';
        isFixable = false;
      }
    }

    return {
      runId,
      domain,
      scenarioType,
      scriptPath,
      success: false,
      exitCode,
      errorType,
      errorMessage: errorSnippet,
      fixRecommendation,
      isFixable,
      scriptContent,
      stdout,
      stderr
    };
  }

  runPlaywrightTest(scriptPath) {
    return new Promise((resolve) => {
      // Execute npx playwright test <scriptPath> --reporter=line
      const child = spawn('npx', ['playwright', 'test', scriptPath, '--reporter=line']);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code
        });
      });
      
      child.on('error', (err) => {
        resolve({
          success: false,
          stdout: '',
          stderr: err.message,
          exitCode: -1
        });
      });
    });
  }

  extractErrorSnippet(output) {
    // Extract first few lines of trace/error
    const lines = output.split('\n');
    const errLines = lines.filter(l => l.includes('Error:') || l.includes('timeout') || l.includes('Failed') || l.includes('at '));
    return errLines.slice(0, 5).join('\n').trim() || 'Playwright execution failed without trace details.';
  }
}

const runtimeAnalyzerAgent = new RuntimeAnalyzerAgent();
export default runtimeAnalyzerAgent;
