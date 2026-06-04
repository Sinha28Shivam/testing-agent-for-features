import nodemailer from 'nodemailer';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import llmClient from '../core/LlmClient.js';

dotenv.config();

class MailAgent {
  constructor() {
    this.smtpHost = process.env.SMTP_HOST;
    this.smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    this.smtpSecure = process.env.SMTP_SECURE === 'true';
    this.smtpUser = process.env.SMTP_USER;
    this.smtpPass = process.env.SMTP_PASS;
    this.smtpFrom = process.env.SMTP_FROM || '"AI Multi-Agent Test Platform" <noreply@example.com>';
    this.smtpTo = process.env.SMTP_TO;
  }

  isConfigured() {
    return (
      this.smtpHost &&
      this.smtpUser &&
      this.smtpPass &&
      this.smtpUser !== 'your-email@gmail.com' &&
      this.smtpTo &&
      this.smtpTo !== 'recipient-email@gmail.com'
    );
  }

  async sendReport(runs) {
    if (runs.length === 0) {
      console.log('[MailAgent] No completed runs found to mail.');
      return;
    }

    if (!this.isConfigured()) {
      console.warn('[MailAgent Warning] SMTP configuration is incomplete or uses defaults in .env. Skipping email report.');
      console.log('[MailAgent] To enable email reports, configure SMTP settings in your .env file.');
      return;
    }

    console.log('[MailAgent] Generating AI Executive Summary...');
    const aiSummary = await this.generateAiSummary(runs);

    console.log('[MailAgent] Preparing HTML email report...');
    const htmlContent = this.compileHtmlReport(runs, aiSummary);

    const attachments = [];
    try {
      const junitPath = path.resolve('test-results/junit/results.xml');
      const hasJunit = await fs.access(junitPath).then(() => true).catch(() => false);
      if (hasJunit) {
        attachments.push({
          filename: 'junit-results.xml',
          path: junitPath
        });
        console.log('[MailAgent] Attached JUnit XML results.');
      }
    } catch (e) {
      // Ignore optional attachment errors.
    }

    console.log(`[MailAgent] Sending email report via ${this.smtpHost}...`);
    try {
      const transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass
        }
      });

      const totals = this.calculateTotals(runs);
      const statusText = this.getSuiteStatus(totals).text;

      const info = await transporter.sendMail({
        from: this.smtpFrom,
        to: this.smtpTo,
        subject: `[Test Report] AI Suite Execution Result - ${statusText} (${totals.passed} passed, ${totals.failed} failed, ${totals.total} total)`,
        html: htmlContent,
        attachments
      });

      console.log('[MailAgent] Email report sent successfully! Message ID:', info.messageId);
    } catch (err) {
      console.error('[MailAgent Error] Failed to send email report:', err.message);
    }
  }

  async generateAiSummary(runs) {
    const totals = this.calculateTotals(runs);
    const runDetails = runs.map((r, i) => {
      const durationSec = (r.durationMs / 1000).toFixed(2);

      // Determine accurate per-scenario status (same logic as the HTML table)
      const sf = r.testStats?.statusFromStats;
      let statusLabel;
      if (sf === 'passed') {
        statusLabel = 'PASSED';
      } else if (sf === 'partial') {
        statusLabel = 'PARTIAL PASS';
      } else if (sf === 'failed') {
        statusLabel = 'FAILED';
      } else {
        statusLabel = r.passed ? 'PASSED' : 'FAILED';
      }

      const caseSummary = this.formatCaseSummary(r.testStats);

      // Include error context for any non-fully-passing scenario
      const isProblematic = statusLabel === 'FAILED' || statusLabel === 'PARTIAL PASS';
      const errorMsg = isProblematic
        ? `\n- Error/Logs:\n${r.stderr || r.stdout || 'Unknown failure'}`.substring(0, 500)
        : '';

      return `Test #${i + 1}: "${r.name}"
- Category: ${r.scenarioType}
- Domain: ${r.domain}
- Scenario Status: ${statusLabel}
- Test Case Summary: ${caseSummary}
- Duration: ${durationSec}s${errorMsg}`;
    }).join('\n\n');

    const prompt = `You are a test lead reporting on a completed test suite execution batch.
Here are the aggregate test case metrics:
- Total test cases: ${totals.total}
- Passed test cases: ${totals.passed}
- Failed test cases: ${totals.failed}
- Skipped test cases: ${totals.skipped}
- Flaky test cases: ${totals.flaky}
- Timed out test cases: ${totals.timedOut}
- Interrupted test cases: ${totals.interrupted}

Here are the details of all executed test scenarios:

${runDetails}

INSTRUCTIONS:
1. Write a professional, concise, and highly insightful Executive Summary of this test suite execution.
2. Mention passed test cases as well as failed ones. If everything passed, highlight that clearly.
3. Explain failures and next steps when failures exist.
4. Call out any notable performance details, such as scenarios with long durations.
5. Output your response ONLY in clean, well-formatted HTML using tags like <p>, <ul>, <li>, and <strong>.
6. DO NOT wrap your response in markdown code blocks like \`\`\`html or \`\`\`xml. Output ONLY raw HTML tags.
7. Keep the summary under 300 words.`;

    try {
      const response = await llmClient.ask(prompt);
      return response.trim();
    } catch (e) {
      console.error('[MailAgent Error] Failed to generate AI summary, using fallback text:', e.message);
      return `<p>The test suite completed with ${totals.passed} passed, ${totals.failed} failed, and ${totals.total} total test cases. Detailed results are tabulated below.</p>`;
    }
  }

  compileHtmlReport(runs, aiSummary) {
    const totals = this.calculateTotals(runs);
    const totalDurationSec = (runs.reduce((sum, r) => sum + r.durationMs, 0) / 1000).toFixed(2);
    const passRate = totals.total > 0 ? ((totals.passed / totals.total) * 100).toFixed(1) : '0.0';
    const suiteStatus = this.getSuiteStatus(totals);

    const tableRows = runs.map((r) => {
      const durationSec = (r.durationMs / 1000).toFixed(2);

      // Determine per-row display status from parsed stats first, then fall back to the `passed` flag
      const statsStatus = r.testStats?.statusFromStats;
      let rowStatusText, rowStatusBg, rowStatusColor;
      if (statsStatus === 'passed') {
        rowStatusText = 'PASSED';
        rowStatusBg  = 'hsl(120, 80%, 96%)';
        rowStatusColor = 'hsl(120, 60%, 25%)';
      } else if (statsStatus === 'partial') {
        rowStatusText = 'PARTIAL';
        rowStatusBg  = 'hsl(45, 100%, 94%)';
        rowStatusColor = 'hsl(38, 92%, 20%)';
      } else if (statsStatus === 'failed') {
        rowStatusText = 'FAILED';
        rowStatusBg  = 'hsl(0, 80%, 96%)';
        rowStatusColor = 'hsl(0, 60%, 25%)';
      } else {
        // No parsed stats — fall back to the resolved `passed` boolean
        rowStatusText  = r.passed ? 'PASSED' : 'FAILED';
        rowStatusBg    = r.passed ? 'hsl(120, 80%, 96%)' : 'hsl(0, 80%, 96%)';
        rowStatusColor = r.passed ? 'hsl(120, 60%, 25%)' : 'hsl(0, 60%, 25%)';
      }

      const caseSummary = this.formatCaseSummary(r.testStats);

      let errorCell = '';
      if (rowStatusText === 'FAILED' || rowStatusText === 'PARTIAL') {
        const cleanErr = (r.stderr || r.stdout || 'Execution failure')
          .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
          .substring(0, 200);
        errorCell = `<div style="font-size: 11px; color: #7f2020; margin-top: 5px; font-family: monospace; background: #fff5f5; padding: 6px; border-radius: 4px; border: 1px solid #ffe3e3;">${this.escapeHtml(cleanErr)}...</div>`;
      }

      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            <strong style="color: #333;">${this.escapeHtml(r.name)}</strong>
            <div style="font-size: 12px; color: #666; margin-top: 2px;">Domain: ${this.escapeHtml(r.domain)}</div>
            ${errorCell}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-transform: capitalize; color: #555;">
            ${this.escapeHtml((r.scenarioType || '').replace('_', ' '))}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; color: #555;">
            ${this.escapeHtml(caseSummary)}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
            <span style="display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; background-color: ${rowStatusBg}; color: ${rowStatusColor};">
              ${rowStatusText}
            </span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: 500; color: #333;">
            ${durationSec}s
          </td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Test Execution Report</title>
      </head>
      <body style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 20px; color: #333;">
        <div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #eef2f6;">
          <div style="padding: 24px; background: linear-gradient(135deg, #1f2937, #111827); color: #ffffff; text-align: center;">
            <h1 style="margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.5px;">AI Test Agent Platform</h1>
            <p style="margin: 6px 0 0; font-size: 13px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Execution Result Report</p>
          </div>

          <div style="padding: 24px;">
            <div style="padding: 16px; margin-bottom: 24px; border-radius: 6px; background-color: ${suiteStatus.bg}; color: ${suiteStatus.color}; border: 1px solid ${suiteStatus.color}; text-align: center;">
              <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.8;">Suite Status</div>
              <div style="font-size: 26px; font-weight: 800; margin-top: 4px; letter-spacing: 0.5px;">${suiteStatus.text}</div>
              <div style="font-size: 13px; font-weight: 600; margin-top: 6px;">${totals.passed} passed / ${totals.failed} failed / ${totals.total} total</div>
            </div>

            <h3 style="margin: 0 0 10px; font-size: 15px; color: #4b5563; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
              AI Executive Summary
            </h3>
            <div style="padding: 18px; margin-bottom: 24px; background-color: #f3f4f6; border-radius: 6px; border-left: 4px solid #3b82f6; font-size: 14px; line-height: 1.6; color: #374151;">
              ${aiSummary}
            </div>

            <h3 style="margin: 0 0 10px; font-size: 15px; color: #4b5563; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
              Execution Metrics
            </h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;">
              <div style="background-color: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; text-align: center;">
                <div style="font-size: 11px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Test Cases Run</div>
                <div style="font-size: 20px; font-weight: bold; color: #111827; margin-top: 2px;">${totals.total}</div>
              </div>
              <div style="background-color: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; text-align: center;">
                <div style="font-size: 11px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Pass Rate</div>
                <div style="font-size: 20px; font-weight: bold; color: #10b981; margin-top: 2px;">${passRate}%</div>
              </div>
              <div style="background-color: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; text-align: center;">
                <div style="font-size: 11px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Passed / Failed</div>
                <div style="font-size: 20px; font-weight: bold; color: #1f2937; margin-top: 2px;">
                  <span style="color: #10b981;">${totals.passed}</span> / <span style="color: #ef4444;">${totals.failed}</span>
                </div>
              </div>
              <div style="background-color: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #f3f4f6; text-align: center;">
                <div style="font-size: 11px; color: #9ca3af; font-weight: bold; text-transform: uppercase;">Total Duration</div>
                <div style="font-size: 20px; font-weight: bold; color: #1f2937; margin-top: 2px;">${totalDurationSec}s</div>
              </div>
            </div>

            <h3 style="margin: 0 0 10px; font-size: 15px; color: #4b5563; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
              Scenario Details
            </h3>
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
              <thead>
                <tr style="background-color: #f9fafb; color: #6b7280; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">
                  <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Scenario</th>
                  <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Type</th>
                  <th style="padding: 10px; border-bottom: 2px solid #e5e7eb;">Cases</th>
                  <th style="padding: 10px; border-bottom: 2px solid #e5e7eb; text-align: center;">Status</th>
                  <th style="padding: 10px; border-bottom: 2px solid #e5e7eb; text-align: right;">Time</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>

          <div style="padding: 16px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af;">
            This email was auto-generated by the AI Multi-Agent Test System (v3.0).<br>
            Allure reports and artifacts are stored locally in the workspace.
          </div>
        </div>
      </body>
      </html>
    `;
  }

  calculateTotals(runs) {
    const totals = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      timedOut: 0,
      interrupted: 0
    };

    for (const run of runs) {
      if (run.testStats && Number.isFinite(run.testStats.total) && run.testStats.total > 0) {
        // We have fine-grained per-test-case counts from parsePlaywrightSummary
        totals.total       += run.testStats.total;
        totals.passed      += run.testStats.passed      || 0;
        totals.failed      += run.testStats.failed      || 0;
        totals.skipped     += run.testStats.skipped     || 0;
        totals.flaky       += run.testStats.flaky       || 0;
        totals.timedOut    += run.testStats.timedOut    || 0;
        totals.interrupted += run.testStats.interrupted || 0;
      } else {
        // No parsed stats — treat the entire run as 1 virtual test case
        totals.total += 1;
        // Use testStats.statusFromStats if available (even without counts),
        // otherwise fall back to the resolved `passed` boolean
        const sf = run.testStats?.statusFromStats;
        if (sf === 'passed' || (!sf && run.passed)) {
          totals.passed += 1;
        } else {
          totals.failed += 1;
        }
      }
    }

    return totals;
  }

  getSuiteStatus(totals) {
    if (totals.failed === 0 && totals.timedOut === 0 && totals.interrupted === 0) {
      return {
        text: 'PASSED',
        color: 'hsl(120, 60%, 25%)',
        bg: 'hsl(120, 80%, 95%)'
      };
    }

    if (totals.passed > 0) {
      return {
        text: 'PARTIAL PASS',
        color: 'hsl(38, 92%, 20%)',
        bg: 'hsl(45, 100%, 94%)'
      };
    }

    return {
      text: 'FAILED',
      color: 'hsl(0, 60%, 25%)',
      bg: 'hsl(0, 80%, 95%)'
    };
  }

  formatCaseSummary(stats) {
    if (!stats || !stats.total) {
      return '1 scenario';
    }

    const parts = [];
    if (stats.passed) parts.push(`${stats.passed} passed`);
    if (stats.failed) parts.push(`${stats.failed} failed`);
    if (stats.skipped) parts.push(`${stats.skipped} skipped`);
    if (stats.flaky) parts.push(`${stats.flaky} flaky`);
    if (stats.timedOut) parts.push(`${stats.timedOut} timed out`);
    if (stats.interrupted) parts.push(`${stats.interrupted} interrupted`);

    return parts.length > 0 ? parts.join(', ') : `${stats.total} total`;
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

const mailAgent = new MailAgent();
export default mailAgent;
