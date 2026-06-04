import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

class TestRunnerAgent {
  async run(specPath) {
    console.log(`\n[TestRunnerAgent] Running Playwright test for spec: ${specPath}...`);
    const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();
    const allureResultsDir = path.resolve(process.env.ALLURE_RESULTS_DIR || 'allure-results');
    
    const startTime = Date.now();
    const result = await this.executePlaywrightTest(specPath);
    const durationMs = Date.now() - startTime;
    const allureResultCount = reporterType === 'allure' ? await this.countAllureResults(allureResultsDir) : 0;
    
    let allureGenerated = false;
    let reportPath = '';
    
    // Generate Allure Report if Allure is configured
    const skipInline = process.env.SKIP_INLINE_REPORT === 'true' || parseInt(process.env.MAX_CONCURRENT_RUNS || '1', 10) > 1;
    if (reporterType === 'allure') {
      if (allureResultCount === 0) {
        console.warn(`[TestRunnerAgent Warning] No Allure result JSON files were produced in ${allureResultsDir}.`);
        console.warn('[TestRunnerAgent Warning] The Allure HTML report cannot show current pass/fail data without raw allure-playwright results.');
      }

      if (!skipInline) {
        console.log('[TestRunnerAgent] Allure reporting enabled. Generating Allure HTML report...');
        allureGenerated = await this.generateAllureReport();
      } else {
        console.log('[TestRunnerAgent] Allure reporting enabled. Skipping inline generation to prevent concurrency race conditions.');
      }
      reportPath = path.resolve('test-results/allure-report');
    } else if (reporterType === 'azure' || reporterType === 'junit') {
      reportPath = path.resolve('test-results/junit/results.xml');
    } else {
      reportPath = path.resolve('test-results/html-report');
    }

    this.printReportSummary({
      specPath,
      success: result.success,
      durationMs,
      reporterType,
      reportPath,
      allureGenerated,
      skipInline,
      allureResultCount,
      stdout: result.stdout,
      stderr: result.stderr
    });

    return {
      success: result.success,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      testStats: this.parsePlaywrightSummary(result.stdout, result.stderr),
      allureResultCount,
      reportPath
    };
  }

  parsePlaywrightSummary(stdout = '', stderr = '') {
    const stripAnsi = (str) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const combined = stripAnsi(`${stdout}\n${stderr}`);
    const stats = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      timedOut: 0,
      interrupted: 0,
      statusFromStats: null   // 'passed' | 'partial' | 'failed' | null
    };

    // Playwright prints a final summary block like:
    //   "3 passed (5.3s)"
    //   "1 failed"
    //   "2 skipped"
    //   "1 flaky"
    //   "1 timed out"
    //   "1 interrupted"
    // We only want the LAST occurrence of each to avoid double-counting from
    // retry progress lines.  We scan all matches and keep only the last value.
    const matchers = [
      { key: 'passed',      re: /(\d+)\s+passed(?:\s*\(|$)/gim },
      { key: 'failed',      re: /(\d+)\s+failed(?:\s*\(|$)/gim },
      { key: 'skipped',     re: /(\d+)\s+skipped(?:\s*\(|$)/gim },
      { key: 'flaky',       re: /(\d+)\s+flaky(?:\s*\(|$)/gim },
      { key: 'timedOut',    re: /(\d+)\s+timed\s+out(?:\s*\(|$)/gim },
      { key: 'interrupted', re: /(\d+)\s+interrupted(?:\s*\(|$)/gim },
    ];

    for (const { key, re } of matchers) {
      let last = null;
      let m;
      while ((m = re.exec(combined)) !== null) {
        last = Number(m[1]);
      }
      if (last !== null) {
        stats[key] = last;
      }
    }

    // Prefer the "Running X tests" line for total; fall back to sum
    const runningMatch = combined.match(/Running\s+(\d+)\s+tests?/i);
    if (runningMatch) {
      stats.total = Number(runningMatch[1]);
    }

    const countedTotal = stats.passed + stats.failed + stats.skipped + stats.flaky + stats.timedOut + stats.interrupted;
    if (!stats.total && countedTotal > 0) {
      stats.total = countedTotal;
    }

    if (stats.total === 0 && countedTotal === 0) {
      return null;
    }

    // Derive a status string from actual test-case counts
    if (stats.failed === 0 && stats.timedOut === 0 && stats.interrupted === 0) {
      stats.statusFromStats = 'passed';
    } else if (stats.passed > 0) {
      stats.statusFromStats = 'partial';
    } else {
      stats.statusFromStats = 'failed';
    }

    return stats;
  }

  executePlaywrightTest(specPath) {
    return new Promise((resolve) => {
      // Use npx playwright test <specPath> with normalized forward slashes and quotes to prevent space issues
      const normalizedPath = `"${specPath.replace(/\\/g, '/')}"`;
      const args = ['playwright', 'test', normalizedPath];
      
      console.log(`[TestRunnerAgent] Command: npx ${args.join(' ')}`);
      
      // Inherit environment variables so REPORTER_TYPE is passed
      const child = spawn('npx', args, {
        env: { ...process.env },
        shell: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Also pipe test progress to the orchestrator log
        process.stdout.write(`[Playwright-Run] ${text}`);
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(`[Playwright-Error] ${text}`);
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr
        });
      });

      child.on('error', (err) => {
        console.error('[TestRunnerAgent Error] Failed to start Playwright runner process:', err);
        resolve({
          success: false,
          stdout: '',
          stderr: err.message
        });
      });
    });
  }

  async countAllureResults(resultsDir = path.resolve(process.env.ALLURE_RESULTS_DIR || 'allure-results')) {
    try {
      const files = await fs.readdir(resultsDir);
      return files.filter(file => file.endsWith('-result.json')).length;
    } catch (err) {
      return 0;
    }
  }

  async generateAllureReport() {
    const resultsDir = path.resolve(process.env.ALLURE_RESULTS_DIR || 'allure-results');
    const outputDir = path.resolve('test-results/allure-report');
    const resultCount = await this.countAllureResults(resultsDir);

    if (resultCount === 0) {
      console.warn(`[TestRunnerAgent Warning] Skipping Allure HTML generation because ${resultsDir} has no *-result.json files.`);
      return false;
    }

    return new Promise((resolve) => {
      const args = ['allure', 'generate', resultsDir, '--clean', '-o', outputDir];
      
      console.log(`[TestRunnerAgent] Generating Allure Report: npx ${args.join(' ')}`);
      
      const child = spawn('npx', args, {
        shell: true
      });

      child.on('close', (code) => {
        resolve(code === 0);
      });

      child.on('error', (err) => {
        console.error('[TestRunnerAgent Error] Failed to run Allure generator:', err);
        resolve(false);
      });
    });
  }

  printReportSummary(details) {
    const { specPath, success, durationMs, reporterType, reportPath, allureGenerated, skipInline, allureResultCount } = details;
    const durationSec = (durationMs / 1000).toFixed(2);
    const statusText = success ? 'SUCCESS (PASSED)' : 'FAILED';
    const statusColor = success ? '\x1b[32m' : '\x1b[31m'; // Green vs Red
    const resetColor = '\x1b[0m';

    console.log('\n\x1b[36m====================================================\x1b[0m');
    console.log(`\x1b[36m       PLAYWRIGHT TEST RUN SUMMARY (${reporterType.toUpperCase()})      \x1b[0m`);
    console.log('\x1b[36m====================================================\x1b[0m');
    console.log(`- Spec File:   ${specPath}`);
    console.log(`- Duration:    ${durationSec} seconds`);
    console.log(`- Status:      ${statusColor}${statusText}${resetColor}`);
    
    if (reporterType === 'allure') {
      console.log(`- Raw Results: ${process.env.ALLURE_RESULTS_DIR || 'allure-results'}/ (${allureResultCount} result files)`);
      console.log(`- HTML Report: test-results/allure-report/`);
      if (allureGenerated) {
        console.log(`\n\x1b[33mTo view the interactive Allure Report in your browser, run:\x1b[0m`);
        console.log(`\x1b[1mnpx allure open test-results/allure-report\x1b[0m`);
      } else if (skipInline) {
        console.log(`\n\x1b[33mAllure report will be generated at the end of the orchestrator run.\x1b[0m`);
      } else {
        console.log(`\x1b[31mWarning: Failed to compile Allure results into HTML report.\x1b[0m`);
      }
    } else if (reporterType === 'azure' || reporterType === 'junit') {
      console.log(`- JUnit XML:   ${reportPath}`);
      console.log(`\x1b[32mJUnit XML report generated successfully for Azure Pipelines ingestion.\x1b[0m`);
    } else {
      console.log(`- HTML Report: test-results/html-report/`);
      console.log(`\n\x1b[33mTo view the standard Playwright HTML report, run:\x1b[0m`);
      console.log(`\x1b[1mnpx playwright show-report test-results/html-report\x1b[0m`);
    }
    console.log('\x1b[36m====================================================\n\x1b[0m');
  }
}

const testRunnerAgent = new TestRunnerAgent();
export default testRunnerAgent;
