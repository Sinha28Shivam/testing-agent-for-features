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

dotenv.config();

// Track active pipeline state
const activeRuns = new Map();

async function bootstrap() {
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
}

function setupPipelineOrchestration() {
  // Plan Created -> Execute Browser Session
  messageBus.subscribe(EVENTS.PLAN_CREATED, async (plan) => {
    const run = activeRuns.get(plan.runId);
    if (!run) return;
    
    // Merge plan into run state
    Object.assign(run, plan);
    console.log(`[Orchestrator] Plan received for domain ${plan.domain}. Scenario: ${plan.scenarioType}. Mode: ${plan.executionMode}`);

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
          scriptCode = await codeGenerator.generate({
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            totalSteps: run.totalSteps,
            completed: true,
            completionReason: executionLog.completionReason || 'Success',
            actions: executionLog.actions
          });

          // Save Script version in MongoDB
          await memoryAgent.saveScriptVersion({
            domain: plan.domain,
            version: 1,
            content: scriptCode,
            generatedFromRunId: plan.runId
          });

          // Write script file to tests/generated/{domain}/{runId}.spec.js
          const genDir = path.join('tests', 'generated', plan.domain);
          await fs.mkdir(genDir, { recursive: true });
          const specPath = path.join(genDir, `${plan.runId}.spec.js`);
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

          // 5. Push Decision Council
          console.log('[Orchestrator] Requesting push decision council review...');
          const pushDecision = await pushDecisionCouncil.deliberate({
            runId: plan.runId,
            domain: plan.domain,
            scenarioType: plan.scenarioType,
            scriptPath: specPath,
            validationScore: run.validationScore,
            healingAttempts: 0,
            success: true
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

  completedPromptsCount++;
  activeRuns.delete(runId);

  checkGracefulShutdown();
}

async function main() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.error('Error: Please provide a test prompt, e.g. npm start "Test search at https://demo.playwright.dev/todomvc"');
    console.error('Or a path to a scenarios file, e.g. npm start scenarios.yaml');
    process.exit(1);
  }

  await bootstrap();

  let prompts = [];
  if (arg.endsWith('.yaml') || arg.endsWith('.yml') || arg.endsWith('.txt')) {
    try {
      const fileContent = await fs.readFile(arg, 'utf-8');
      if (arg.endsWith('.yaml') || arg.endsWith('.yml')) {
        const parsed = yaml.load(fileContent);
        if (parsed && Array.isArray(parsed.scenarios)) {
          prompts = parsed.scenarios.map(s => s.prompt).filter(Boolean);
        } else {
          throw new Error('YAML must contain a "scenarios" list with "prompt" keys.');
        }
      } else {
        prompts = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
      }
      console.log(`[Orchestrator] Loaded ${prompts.length} scenarios from file: ${arg}`);
    } catch (err) {
      console.error(`[Orchestrator Error] Failed to read/parse scenarios file: ${err.message}`);
      process.exit(1);
    }
  } else {
    prompts = [arg];
  }

  totalPromptsCount = prompts.length;

  // Run sequentially
  for (const prompt of prompts) {
    const runId = uuidv4();
    activeRuns.set(runId, {
      runId,
      prompt,
      startTime: Date.now(),
      passed: false,
      totalSteps: 0,
      copilotCalls: 0
    });

    console.log(`\n[Orchestrator] Starting run: ${runId} with prompt: "${prompt}"`);
    await messageBus.publish(EVENTS.PLAN_REQUESTED, {
      runId,
      prompt
    });

    // Wait until this run finishes (activeRuns is cleared of this runId)
    while (activeRuns.has(runId)) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

main().catch(err => {
  console.error('[Orchestrator Fatal Error]', err);
  process.exit(1);
});
