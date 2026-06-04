import mailAgent from '../src/agents/MailAgent.js';
import fs from 'fs/promises';
import path from 'path';

async function testMailGeneration() {
  const mockRuns = [
    {
      name: "SMK-001: MSN Homepage Load Verification",
      prompt: "Navigate to https://www.msn.com/en-in, verify load, take screenshot",
      domain: "www.msn.com",
      scenarioType: "Smoke_Testing",
      passed: true,
      durationMs: 4817,
      stdout: "Running 2 tests using 1 worker\n  2 passed (4.8s)",
      stderr: "",
      testStats: {
        total: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        flaky: 0,
        timedOut: 0,
        interrupted: 0,
        statusFromStats: 'passed'
      }
    },
    {
      name: "REG-001: MSN Navigation Sports Section Verification",
      prompt: "Navigate to https://www.msn.com/en-in, click Sports section link, verify sports page loads",
      domain: "www.msn.com",
      scenarioType: "Regression_Testing",
      passed: false,
      durationMs: 12430,
      stdout: "Running 3 tests using 1 worker\n  2 passed\n  1 failed (12.4s)",
      stderr: "Error: element 'Sports' not found. Timeout 10000ms exceeded.",
      testStats: {
        total: 3,
        passed: 2,
        failed: 1,
        skipped: 0,
        flaky: 0,
        timedOut: 0,
        interrupted: 0,
        statusFromStats: 'partial'
      }
    },
    {
      name: "PERF-001: MSN Homepage Startup Performance and Load Time",
      prompt: "Navigate to https://www.msn.com/en-in, measure page load time",
      domain: "www.msn.com",
      scenarioType: "Performance_Testing",
      passed: false,
      durationMs: 31500,
      stdout: "Running 1 test using 1 worker\n  1 failed (31.5s)",
      stderr: "Test timeout of 30000ms exceeded while running 'page.goto'.",
      testStats: {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        flaky: 0,
        timedOut: 0,
        interrupted: 0,
        statusFromStats: 'failed'
      }
    }
  ];

  console.log('--- Testing AI Executive Summary Generation ---');
  try {
    const aiSummary = await mailAgent.generateAiSummary(mockRuns);
    console.log('\nAI Summary output:');
    console.log(aiSummary);

    console.log('\n--- Compiling HTML Email Template ---');
    const htmlReport = mailAgent.compileHtmlReport(mockRuns, aiSummary);

    // Save to scratch for visual verification in browser
    const outputPath = path.resolve('scratch/test_email_report.html');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, htmlReport, 'utf-8');

    console.log(`\nSuccess! Compiled HTML report written to: ${outputPath}`);
    console.log('Open that file in a browser to visually verify the email layout.');

    console.log('\n--- Sending Real Email Report (requires .env SMTP config) ---');
    await mailAgent.sendReport(mockRuns);
  } catch (err) {
    console.error('Error during mail testing:', err);
  }
}

testMailGeneration();
