import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

class TestRunnerAgent {
  async run(specPath) {
    console.log(`\n[TestRunnerAgent] Running Playwright test for spec: ${specPath}...`);
    const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();
    
    const startTime = Date.now();
    const result = await this.executePlaywrightTest(specPath);
    const durationMs = Date.now() - startTime;
    
    let allureGenerated = false;
    let reportPath = '';
    
    // Generate Allure Report if Allure is configured
    const skipInline = process.env.SKIP_INLINE_REPORT === 'true' || parseInt(process.env.MAX_CONCURRENT_RUNS || '1', 10) > 1;
    if (reporterType === 'allure') {
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
      stdout: result.stdout,
      stderr: result.stderr
    });

    return {
      success: result.success,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      reportPath
    };
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

  generateAllureReport() {
    return new Promise((resolve) => {
      // Command: npx allure generate allure-results --clean -o test-results/allure-report
      const args = ['allure', 'generate', 'allure-results', '--clean', '-o', 'test-results/allure-report'];
      
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
    const { specPath, success, durationMs, reporterType, reportPath, allureGenerated, skipInline } = details;
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
      console.log(`- Raw Results: allure-results/`);
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
