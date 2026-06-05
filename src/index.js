import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import messageBus, { EVENTS } from './core/MessageBus.js';
import llmClient from './core/LlmClient.js';
import MCPBridge from './core/MCPBridge.js';
import memoryAgent from './agents/MemoryAgent.js';
import plannerAgent from './agents/PlannerAgent.js';
import agentLoop from './agents/AgentLoop.js';
import replayExecutor from './agents/ReplayExecutor.js';
import codeGenerator from './agents/CodeGenerator.js';
import staticAnalyzerAgent from './agents/StaticAnalyzerAgent.js';
import pushDecisionCouncil from './agents/PushDecisionCouncil.js';
import gitAgent from './agents/GitAgent.js';
import issueAgent from './agents/IssueAgent.js';
import testRunnerAgent from './agents/TestRunnerAgent.js';
import mailAgent from './agents/MailAgent.js';

dotenv.config();

// Track active pipeline state
const activeRuns = new Map();
const completedRuns = [];

// Programmatic mode variables
let isInitialized = false;
let isProgrammatic = false;
let programmaticResolve = null;
let programmaticReject = null;

function extractTargetUrlFromText(text = '') {
  const urlMatch = /(https?:\/\/[^\s"'`\)]+)/i.exec(text);
  if (urlMatch) {
    return urlMatch[1].replace(/[,.]$/, '');
  }

  const wwwMatch = /(www\.[^\s"'`\)]+)/i.exec(text);
  if (wwwMatch) {
    return `https://${wwwMatch[1]}`.replace(/[,.]$/, '');
  }

  return null;
}

function extractDomainFromUrl(targetUrl) {
  try {
    return new URL(targetUrl).hostname;
  } catch (e) {
    return 'unknown';
  }
}

function normalizePlanTarget(plan) {
  const promptUrl = extractTargetUrlFromText(plan.prompt || '');
  if (!promptUrl) {
    return plan;
  }

  const promptDomain = extractDomainFromUrl(promptUrl);
  if (plan.targetUrl !== promptUrl || plan.domain !== promptDomain) {
    console.warn(`[Orchestrator] Correcting plan target from ${plan.targetUrl || 'unknown'} to prompt URL ${promptUrl}.`);
    plan.targetUrl = promptUrl;
    plan.domain = promptDomain;
  }

  return plan;
}

async function resolveScriptPath(plan) {
  normalizePlanTarget(plan);

  let config = null;
  try {
    const configPath = path.resolve('folderConfig.json');
    const content = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(content);
  } catch (err) {
    console.warn('[Orchestrator] Failed to load folderConfig.json, using fallback logic:', err.message);
  }

  // Fallbacks
  const defaults = config?.defaults || { testType: 'Regression_Testing', feature: 'general' };
  const testTypes = config?.testTypes || {
    "Smoke_Testing": ["smoke", "sanity", "basic", "load verification", "homepage loads", "smoke test"],
    "Performance_Testing": ["performance", "load test", "stress", "speed", "benchmark", "lighthouse"],
    "Regression_Testing": []
  };
  const features = config?.features || {
    "settings": ["settings", "profile", "account", "preference", "options"],
    "personalized": ["personalized", "feed", "my feed", "recommendations", "interests"],
    "homepage": ["homepage", "home", "landing", "index"]
  };

  const searchText = `${plan.name || ''} ${plan.title || ''} ${plan.prompt || ''}`.toLowerCase();

  // 1. Determine testType
  let resolvedTestType = defaults.testType;
  for (const [type, keywords] of Object.entries(testTypes)) {
    if (keywords && keywords.length > 0) {
      if (keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
        resolvedTestType = type;
        break;
      }
    }
  }

  // 2. Determine siteName
  let siteName = 'unknown';
  if (plan.domain && plan.domain !== 'unknown') {
    let clean = plan.domain.toLowerCase();
    if (clean.startsWith('www.')) {
      clean = clean.substring(4);
    }
    const parts = clean.split('.');
    if (parts.length > 1) {
      const commonSLDs = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'mil', 'asn', 'intl']);
      if (parts.length >= 3 && commonSLDs.has(parts[parts.length - 2])) {
        siteName = parts[parts.length - 3];
      } else {
        siteName = parts[parts.length - 2];
      }
    } else {
      siteName = clean;
    }
  } else {
    // Attempt to extract from targetUrl if domain is unknown
    const targetUrl = plan.targetUrl || '';
    if (targetUrl.startsWith('http')) {
      try {
        const parsedUrl = new URL(targetUrl);
        let clean = parsedUrl.hostname.toLowerCase();
        if (clean.startsWith('www.')) {
          clean = clean.substring(4);
        }
        const parts = clean.split('.');
        if (parts.length > 1) {
          const commonSLDs = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'mil', 'asn', 'intl']);
          if (parts.length >= 3 && commonSLDs.has(parts[parts.length - 2])) {
            siteName = parts[parts.length - 3];
          } else {
            siteName = parts[parts.length - 2];
          }
        } else {
          siteName = clean;
        }
      } catch (e) {
        // Fallback
      }
    }
  }

  // 3. Determine featureName
  let resolvedFeature = defaults.feature;
  for (const [feat, keywords] of Object.entries(features)) {
    if (keywords && keywords.length > 0) {
      if (keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
        resolvedFeature = feat;
        break;
      }
    }
  }

  // 4. Determine descriptive filename
  let baseName = plan.name || plan.title || '';
  if (!baseName) {
    const cleanPrompt = (plan.prompt || '')
      .toLowerCase()
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join('-');
    baseName = `${plan.scenarioType || 'test'}-${cleanPrompt}`;
  }
  let slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    slug = plan.runId;
  }
  const fileName = `${slug}.spec.js`;

  const relativeDir = path.join('tests', resolvedTestType, siteName, resolvedFeature);
  return {
    dir: relativeDir,
    file: fileName,
    fullPath: path.join(relativeDir, fileName)
  };
}

export async function bootstrap() {
  if (isInitialized) {
    return;
  }
  console.log('====================================================');
  console.log('       AI MULTI-AGENT TEST PLATFORM v3.0            ');
  console.log('====================================================\n');

  // 1. Connect to Message Bus and Databases
  await messageBus.connect();
  await memoryAgent.connect();

  // 2. Initialize all agents
  await plannerAgent.init();
  await staticAnalyzerAgent.init();
  await pushDecisionCouncil.init();
  await gitAgent.init();
  await issueAgent.init();

  console.log('\n[Orchestrator] All v3.0 agents successfully initialized and wired to MessageBus.');

  // 3. Setup event flow orchestration
  setupPipelineOrchestration();
  
  isInitialized = true;
}

function setupPipelineOrchestration() {
  // Plan Created -> Execute Browser Session
  messageBus.subscribe(EVENTS.PLAN_CREATED, async (plan) => {
    const run = activeRuns.get(plan.runId);
    if (!run) return;
    
    // Merge plan into run state
    normalizePlanTarget(plan);
    Object.assign(run, plan);
    console.log(`[Orchestrator] Plan received for domain ${plan.domain}. Scenario: ${plan.scenarioType}. Mode: ${plan.executionMode}`);

    // Resolve script path info and attach to plan
    const pathInfo = await resolveScriptPath(plan);
    plan.resolvedPathInfo = pathInfo;

    const mcpBridge = new MCPBridge();
    let mcpToolCallsCount = 0;

    // Track total MCP calls
    const originalCallTool = mcpBridge.callTool.bind(mcpBridge);
    mcpBridge.callTool = async (toolName, args) => {
      mcpToolCallsCount++;
      return await originalCallTool(toolName, args);
    };

    try {
      await mcpBridge.start();
      
      let executionLog = null;
      let passed = false;
      let replayFallbackToExplore = false;

      // --- 1. REPLAY MODE ---
      if (plan.executionMode === 'replay') {
        try {
          const replayResult = await replayExecutor.execute(plan.storedSequence, mcpBridge);
          if (replayResult.success) {
            console.log('[Orchestrator] REPLAY execution PASSED!');
            passed = true;
            executionLog = {
              actions: replayResult.actions,
              completed: true,
              completionReason: 'Replay succeeded',
              copilotCallsUsed: 0
            };
            // Update PostgreSQL action sequence success stats
            await memoryAgent.recordReplayResult(plan.domain, plan.scenarioType, true);
          } else {
            console.warn(`[Orchestrator] REPLAY execution FAILED at step ${replayResult.failedAtStep}: ${replayResult.reason}. Falling back to EXPLORE mode.`);
            replayFallbackToExplore = true;
            await memoryAgent.recordReplayResult(plan.domain, plan.scenarioType, false);
            
            // Restart browser session for EXPLORE fallback
            await mcpBridge.stop();
            await mcpBridge.start();
          }
        } catch (err) {
          console.error('[Orchestrator Error] Replay execution crashed. Falling back to EXPLORE:', err.message);
          replayFallbackToExplore = true;
          await mcpBridge.stop().catch(() => {});
          await mcpBridge.start();
        }
      }

      // --- 2. EXPLORE MODE (or Fallback) ---
      if (plan.executionMode === 'explore' || replayFallbackToExplore) {
        try {
          executionLog = await agentLoop.run(plan, mcpBridge);
          passed = true;
          console.log('[Orchestrator] EXPLORE execution completed successfully.');
        } catch (err) {
          console.error('[Orchestrator] EXPLORE execution FAILED:', err.message);
          passed = false;
          run.exploreError = err.message;
          
          // Log failure to Postgres failure_log
          await memoryAgent.writeFailureLog({
            runId: plan.runId,
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            failedAtStep: agentLoop.stepCount,
            errorType: 'runtime_error',
            errorMessage: err.message,
            snapshotAtFailure: null,
            copilotLastDecision: null
          });
        }
      }

      run.passed = passed;
      run.totalSteps = executionLog ? executionLog.actions.length : 0;
      run.copilotCalls = executionLog ? executionLog.copilotCallsUsed : 0;
      run.mcpToolCalls = mcpToolCallsCount;
      run.replayFallbackToExplore = replayFallbackToExplore;

      if (passed && executionLog) {
        // 1. Save Full Action Log to MongoDB
        await memoryAgent.saveActionLog({
          runId: plan.runId,
          domain: plan.domain,
          scenarioType: plan.scenarioType,
          executionMode: plan.executionMode,
          actions: executionLog.actions,
          totalSteps: run.totalSteps,
          durationMs: Date.now() - run.startTime,
          completed: true,
          completionReason: executionLog.completionReason || 'Success',
          copilotCallsUsed: run.copilotCalls
        });

        // 2. Save Distilled Sequence to Postgres as Candidate if explore run
        if (plan.executionMode === 'explore' || replayFallbackToExplore) {
          const storableSequence = agentLoop.stepCount > 0 ? executionLog.actions.map(a => {
            const step = { tool: a.tool, args: { ...a.args } };
            // Mask sensitive credentials
            if (a.tool === 'browser_fill') {
              const lowerSelector = (a.args.selector || '').toLowerCase();
              const value = a.args.value || '';
              if (lowerSelector.includes('email') || lowerSelector.includes('username') || value.includes('@')) {
                step.valueType = 'email';
                delete step.args.value;
              } else if (lowerSelector.includes('password') || lowerSelector.includes('pass')) {
                step.valueType = 'password';
                delete step.args.value;
              }
            }
            return step;
          }) : [];

          await memoryAgent.saveActionSequence({
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            sequence: storableSequence,
            sourceRunId: plan.runId,
            state: 'candidate'
          });

          // Store accessibility patterns derived from navigation/clicking actions
          for (const action of executionLog.actions) {
            if (action.tool === 'browser_fill' || action.tool === 'browser_click') {
              const selector = action.args.selector || '';
              if (selector.includes('getByRole') || selector.includes('getByLabel') || selector.includes('getByPlaceholder') || selector.includes('getByText')) {
                await memoryAgent.recordPatternSuccess({
                  domain: plan.domain,
                  intent: plan.scenarioType,
                  pattern: selector
                });
              }
            }
          }
        }

        // 3. Code Generation (explore or first-time replay success)
        let scriptCode = '';
        try {
          const pathInfo = plan.resolvedPathInfo;
          
          scriptCode = await codeGenerator.generate({
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            totalSteps: run.totalSteps,
            completed: true,
            completionReason: executionLog.completionReason || 'Success',
            actions: executionLog.actions,
            testDir: pathInfo.dir
          });

          // Save Script version in MongoDB
          await memoryAgent.saveScriptVersion({
            domain: plan.domain,
            version: 1,
            content: scriptCode,
            generatedFromRunId: plan.runId
          });

          // Write script file to dynamic directory based on configuration
          await fs.mkdir(pathInfo.dir, { recursive: true });
          const specPath = pathInfo.fullPath;
          await fs.writeFile(specPath, scriptCode, 'utf-8');
          run.scriptPath = specPath;
          console.log(`[Orchestrator] Playwright spec script written to: ${specPath}`);

          // 4. Static Analysis
          console.log('[Orchestrator] Requesting static analysis...');
          const analysisResult = await staticAnalyzerAgent.analyze({
            runId: plan.runId,
            domain: plan.domain,
            scriptPath: specPath,
            targetUrl: plan.targetUrl
          });

          run.validationScore = analysisResult.validationScore;

          if (!analysisResult.passed) {
            console.error('[Orchestrator] Static check FAILED. Issues:', analysisResult.issues);
            await messageBus.publish(EVENTS.ISSUE_REQUESTED, {
              runId: plan.runId,
              domain: plan.domain,
              title: 'Static validation failure',
              body: JSON.stringify(analysisResult.issues, null, 2),
              labels: ['static_check_failed']
            });
            await shutdownRun(plan.runId, 'failed_static_validation');
            return;
          }

          // 5. Run the generated Playwright test script (dynamic execution validation)
          const runResult = await testRunnerAgent.run(specPath);
          run.runnerPassed = runResult.success;
          run.runnerDurationMs = runResult.durationMs;
          run.reportPath = runResult.reportPath;
          run.runnerStdout = runResult.stdout;
          run.runnerStderr = runResult.stderr;
          run.testStats = runResult.testStats;

          // Determine actual failure using parsed test stats as the primary signal.
          // A process exit code of 1 does NOT always mean all tests failed —
          // e.g. Playwright exits 1 if ANY test failed even when others passed.
          const statsStatus = runResult.testStats?.statusFromStats;
          const isActualFailure =
            statsStatus === 'failed' ||           // all tests failed
            (!statsStatus && !runResult.success); // no parsed stats + bad exit code

          if (isActualFailure) {
            console.error('[Orchestrator] Playwright test runner validation FAILED. Raising issue request...');
            await messageBus.publish(EVENTS.ISSUE_REQUESTED, {
              runId: plan.runId,
              domain: plan.domain,
              title: `Playwright test execution failure for ${plan.domain}`,
              body: `The generated test script failed during execution under reporter ${process.env.REPORTER_TYPE || 'default'}. Check console log or Allure/Azure reports.`,
              labels: ['test_execution_failed']
            });
          } else if (statsStatus === 'partial') {
            console.warn('[Orchestrator] Playwright test runner had PARTIAL failures (some tests passed, some failed).');
          }

          // 6. Push Decision Council
          console.log('[Orchestrator] Requesting push decision council review...');
          const pushDecision = await pushDecisionCouncil.deliberate({
            runId: plan.runId,
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            scriptPath: specPath,
            validationScore: run.validationScore,
            healingAttempts: 0,
            success: run.runnerPassed
          });

          if (pushDecision.shouldPush) {
            console.log('[Orchestrator] Push APPROVED. Invoking GitAgent...');
            const pushResult = await gitAgent.pushToGit({
              runId: plan.runId,
              scriptPath: specPath,
              domain: plan.domain
            });
            if (pushResult.success) {
              await shutdownRun(plan.runId, 'pushed');
            } else {
              await shutdownRun(plan.runId, 'git_push_failed');
            }
          } else {
            console.log(`[Orchestrator] Push SKIPPED: ${pushDecision.reason}`);
            await shutdownRun(plan.runId, 'skipped');
          }

        } catch (err) {
          console.error('[Orchestrator Error] Code generation or post-processing failed:', err);
          await shutdownRun(plan.runId, 'failed_post_processing');
        }
      } else {
        await shutdownRun(plan.runId, 'failed_execution');
      }

    } catch (err) {
      console.error('[Orchestrator Error] Run execution failed:', err);
      await shutdownRun(plan.runId, 'failed_system_error');
    } finally {
      await mcpBridge.stop();
    }
  });
}

let totalPromptsCount = 0;
let completedPromptsCount = 0;
let hasFailures = false;

function checkGracefulShutdown() {
  if (completedPromptsCount === totalPromptsCount) {
    setTimeout(async () => {
      const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();
      if (reporterType === 'allure') {
        console.log('\n[Orchestrator] Generating unified Allure report...');
        try {
          const allureGenerated = await testRunnerAgent.generateAllureReport();
          if (allureGenerated) {
            console.log('[Orchestrator] Unified Allure report generated successfully.');
          } else {
            console.warn('[Orchestrator Warning] Unified Allure report was not generated because no current raw Allure results were found.');
          }
        } catch (err) {
          console.error('[Orchestrator Error] Failed to generate Allure report:', err);
        }
      }
      
      // Send email report via MailAgent
      try {
        await mailAgent.sendReport(completedRuns);
      } catch (mailErr) {
        console.error('[Orchestrator Error] Failed to send email report:', mailErr.message);
      }
      
      if (isProgrammatic) {
        console.log('[Orchestrator] Programmatic run finished. Keeping connections open for scheduler.');
        if (programmaticResolve) {
          programmaticResolve({ success: !hasFailures, runs: [...completedRuns] });
        }
        return;
      }

      console.log('\n[Orchestrator] Gracefully shutting down connections...');
      await gitAgent.close();
      await memoryAgent.disconnect();
      await messageBus.disconnect();
      console.log('[Orchestrator] System stopped.');
      process.exit(hasFailures ? 1 : 0);
    }, 1500);
  }
}

async function shutdownRun(runId, outcome) {
  const run = activeRuns.get(runId);
  if (!run) return;

  const durationMs = Date.now() - run.startTime;
  console.log(`\n[Orchestrator] Finalizing Run: ${runId}`);
  console.log(`- Domain: ${run.domain}`);
  console.log(`- Outcome: ${outcome.toUpperCase()}`);
  console.log(`- Duration: ${(durationMs / 1000).toFixed(2)} seconds`);

  // Write run history to SQL database
  try {
    await memoryAgent.writeRunHistory({
      runId: run.runId,
      prompt: run.prompt,
      domain: run.domain,
      scenarioType: run.scenarioType,
      executionMode: run.executionMode || 'explore',
      totalSteps: run.totalSteps || 0,
      copilotCalls: run.copilotCalls || 0,
      mcpToolCalls: run.mcpToolCalls || 0,
      passed: run.passed || false,
      healingAttempts: 0,
      pushDecision: outcome === 'pushed' ? 'pushed' : 'skipped',
      durationMs,
      coldStart: run.coldStart,
      replayFallbackToExplore: run.replayFallbackToExplore
    });

    // Update domain profile
    const profile = await memoryAgent.getDomainProfile(run.domain);
    const newTotalExplore = (profile ? profile.total_explore_runs : 0) + (run.executionMode === 'explore' || run.replayFallbackToExplore ? 1 : 0);
    const newTotalReplay = (profile ? profile.total_replay_runs : 0) + (run.executionMode === 'replay' && !run.replayFallbackToExplore ? 1 : 0);

    await memoryAgent.createOrUpdateDomainProfile(run.domain, {
      last_run_at: new Date(),
      last_explore_at: (run.executionMode === 'explore' || run.replayFallbackToExplore) ? new Date() : undefined,
      total_explore_runs: newTotalExplore,
      total_replay_runs: newTotalReplay,
      avg_steps_per_run: profile ? ((parseFloat(profile.avg_steps_per_run) * (newTotalExplore + newTotalReplay - 1) + run.totalSteps) / (newTotalExplore + newTotalReplay)) : run.totalSteps,
      avg_copilot_calls_per_run: profile ? ((parseFloat(profile.avg_copilot_calls_per_run) * (newTotalExplore + newTotalReplay - 1) + run.copilotCalls) / (newTotalExplore + newTotalReplay)) : run.copilotCalls
    });

    console.log('[Orchestrator] Run history and domain profile recorded to PostgreSQL.');
  } catch (err) {
    console.error('[Orchestrator Error] Failed to write run history:', err.message);
  }

  if (outcome.startsWith('failed') || outcome === 'git_push_failed') {
    hasFailures = true;
  }

  // Determine the true pass/fail status for the email report:
  // Priority 1: use parsed test-case counts (most accurate — reflects actual assertions)
  // Priority 2: use Playwright process exit code (run.runnerPassed)
  // Priority 3: fall back to browser-explore result (run.passed)
  let resolvedPassed;
  const stats = run.testStats;
  if (stats && stats.statusFromStats) {
    resolvedPassed = stats.statusFromStats === 'passed' || stats.statusFromStats === 'partial';
  } else if (typeof run.runnerPassed === 'boolean') {
    resolvedPassed = run.runnerPassed;
  } else {
    resolvedPassed = run.passed || false;
  }

  completedRuns.push({
    name: run.name || run.prompt.substring(0, 40) + '...',
    prompt: run.prompt,
    domain: run.domain,
    scenarioType: run.scenarioType,
    passed: resolvedPassed,
    durationMs,
    outcome,
    testStats: run.testStats || null,
    stdout: run.runnerStdout || '',
    stderr: run.runnerStderr || run.exploreError || ''
  });

  completedPromptsCount++;
  activeRuns.delete(runId);

  checkGracefulShutdown();
}

export async function executePipeline(arg, runAsProgrammatic = false) {
  isProgrammatic = runAsProgrammatic;
  
  if (isProgrammatic) {
    return new Promise((resolve, reject) => {
      programmaticResolve = resolve;
      programmaticReject = reject;
      runExecution(arg).catch(reject);
    });
  } else {
    await runExecution(arg);
  }
}

async function runExecution(arg) {
  // Synchronize scenarios from Azure DevOps if enabled
  if (process.env.ADO_FETCH_ON_START === 'true' && (arg.endsWith('.yaml') || arg.endsWith('.yml'))) {
    console.log('[Orchestrator] ADO_FETCH_ON_START is enabled. Syncing scenarios from Azure DevOps...');
    try {
      const { syncScenarios } = await import('./integration/AdoFetcher.js');
      const syncSuccess = await syncScenarios();
      if (syncSuccess) {
        console.log('[Orchestrator] ADO scenarios synced successfully.');
      } else {
        console.warn('[Orchestrator Warning] ADO synchronization returned false. Using local cached file.');
      }
    } catch (err) {
      console.warn('[Orchestrator Warning] Failed to run Azure DevOps synchronization:', err.message);
    }
  }

  // Clean allure-results directory at start of run
  const reporterType = (process.env.REPORTER_TYPE || '').toLowerCase();
  if (reporterType === 'allure') {
    try {
      const allureResultsPath = path.resolve(process.env.ALLURE_RESULTS_DIR || 'allure-results');
      const allureReportPath = path.resolve('test-results/allure-report');
      await fs.rm(allureResultsPath, { recursive: true, force: true });
      await fs.rm(allureReportPath, { recursive: true, force: true });
      console.log('[Orchestrator] Cleared previous Allure results and HTML report.');
    } catch (err) {
      console.warn('[Orchestrator Warning] Failed to clear previous Allure results:', err.message);
    }
  }

  let prompts = [];
  if (arg.endsWith('.yaml') || arg.endsWith('.yml') || arg.endsWith('.txt')) {
    try {
      const fileContent = await fs.readFile(arg, 'utf-8');
      if (arg.endsWith('.yaml') || arg.endsWith('.yml')) {
        const parsed = yaml.load(fileContent);
        if (parsed && Array.isArray(parsed.scenarios)) {
          prompts = parsed.scenarios.filter(s => s.prompt);
        } else {
          throw new Error('YAML must contain a "scenarios" list with "prompt" keys.');
        }
      } else {
        prompts = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#')).map(line => ({ prompt: line, name: null }));
      }
      console.log(`[Orchestrator] Loaded ${prompts.length} scenarios from file: ${arg}`);
    } catch (err) {
      console.error(`[Orchestrator Error] Failed to read/parse scenarios file: ${err.message}`);
      if (!isProgrammatic) {
        process.exit(1);
      }
      throw err;
    }
  } else {
    prompts = [{ prompt: arg, name: null }];
  }

  totalPromptsCount = prompts.length;
  completedPromptsCount = 0;
  hasFailures = false;
  completedRuns.length = 0;

  const maxConcurrency = parseInt(process.env.MAX_CONCURRENT_RUNS || '3', 10);
  console.log(`[Orchestrator] Starting execution of ${totalPromptsCount} scenarios with concurrency limit: ${maxConcurrency}`);

  const runScenario = async (item) => {
    const runId = uuidv4();
    activeRuns.set(runId, {
      runId,
      prompt: item.prompt,
      name: item.name || null,
      startTime: Date.now(),
      passed: false,
      totalSteps: 0,
      copilotCalls: 0
    });

    console.log(`\n[Orchestrator] Starting run: ${runId} with prompt: "${item.prompt}"`);
    await messageBus.publish(EVENTS.PLAN_REQUESTED, {
      runId,
      prompt: item.prompt,
      name: item.name || null
    });

    // Wait until this run finishes (activeRuns is cleared of this runId)
    while (activeRuns.has(runId)) {
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // Process queue with concurrency control
  const queue = [...prompts];
  const workers = Array(Math.min(maxConcurrency, queue.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) {
        try {
          await runScenario(item);
        } catch (err) {
          console.error(`[Orchestrator Error] Scenario run failed:`, err);
        }
      }
    }
  });

  await Promise.all(workers);
}

async function main() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.error('Error: Please provide a test prompt, e.g. npm start "Verify homepage loads at https://www.msn.com/en-in"');
    console.error('Or a path to a scenarios file, e.g. npm start scenarios.yaml');
    process.exit(1);
  }

  await bootstrap();
  await executePipeline(arg, false);
}

// Check if run directly
import { fileURLToPath } from 'url';
const nodePath = path.resolve(process.argv[1]);
const modulePath = fileURLToPath(import.meta.url);
if (nodePath === modulePath || nodePath.replace(/\.[jt]s$/, '') === modulePath.replace(/\.[jt]s$/, '')) {
  main().catch(err => {
    console.error('[Orchestrator Fatal Error]', err);
    process.exit(1);
  });
}
