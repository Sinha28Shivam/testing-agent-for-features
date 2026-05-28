import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import messageBus, { EVENTS } from './core/MessageBus.js';
import llmClient from './core/LlmClient.js';
import memoryAgent from './agents/MemoryAgent.js';
import plannerAgent from './agents/PlannerAgent.js';
import domWorker from './agents/DOMWorker.js';
import specialistGeneratorAgent from './agents/SpecialistGeneratorAgent.js';
import staticAnalyzerAgent from './agents/StaticAnalyzerAgent.js';
import runtimeAnalyzerAgent from './agents/RuntimeAnalyzerAgent.js';
import healingWorker from './agents/HealingWorker.js';
import pushDecisionCouncil from './agents/PushDecisionCouncil.js';
import gitAgent from './agents/GitAgent.js';
import issueAgent from './agents/IssueAgent.js';
import patternMinerAgent from './agents/PatternMinerAgent.js';

dotenv.config();

// Track active pipeline state
const activeRuns = new Map();

async function bootstrap() {
  console.log('====================================================');
  console.log('       AI MULTI-AGENT TEST PLATFORM v2.0            ');
  console.log('====================================================\n');

  // 1. Connect to Message Bus and Databases
  await messageBus.connect();
  await memoryAgent.connect();

  // 2. Initialize all agents
  await plannerAgent.init();
  await domWorker.init();
  await specialistGeneratorAgent.init();
  await staticAnalyzerAgent.init();
  await runtimeAnalyzerAgent.init();
  await healingWorker.init();
  await pushDecisionCouncil.init();
  await gitAgent.init();
  await issueAgent.init();
  await patternMinerAgent.init();

  console.log('\n[Orchestrator] All agents successfully initialized and wired to MessageBus.');

  // 3. Setup event flow orchestration
  setupPipelineOrchestration();
}

function setupPipelineOrchestration() {
  // Plan Created -> Request DOM Extraction
  messageBus.subscribe(EVENTS.PLAN_CREATED, async (plan) => {
    const run = activeRuns.get(plan.runId);
    if (!run) return;
    
    // Merge plan into run state
    Object.assign(run, plan);
    console.log(`[Orchestrator] Plan created for ${plan.domain}. Scenario: ${plan.scenarioType}.`);

    // Next step: DOM extraction
    await messageBus.publish(EVENTS.DOM_EXTRACT_REQUESTED, {
      runId: plan.runId,
      domain: plan.domain,
      targetUrl: plan.targetUrl,
      useCache: plan.useCache
    });
  });

  // DOM Extracted -> Request Code Generation
  messageBus.subscribe(EVENTS.DOM_EXTRACTED, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    run.domSnapshot = payload.snapshot;
    console.log(`[Orchestrator] DOM extracted successfully (Volatility: ${payload.volatilitySignal}).`);

    // Next step: Code Generation
    await messageBus.publish(EVENTS.SCRIPT_GENERATE_REQUESTED, {
      runId: run.runId,
      domain: run.domain,
      scenarioType: run.scenarioType,
      targetUrl: run.targetUrl,
      checklist: run.checklist,
      snapshot: payload.snapshot,
      specialist: run.specialist
    });
  });

  // Script Generated -> Request Static Analysis
  messageBus.subscribe(EVENTS.SCRIPT_GENERATED, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    run.scriptPath = payload.scriptPath;
    run.scriptHash = payload.scriptHash;
    console.log(`[Orchestrator] Playwright script generated successfully.`);

    // Next step: Static Analysis
    await messageBus.publish(EVENTS.STATIC_ANALYSIS_REQUESTED, {
      runId: run.runId,
      domain: run.domain,
      scriptPath: payload.scriptPath,
      targetUrl: run.targetUrl
    });
  });

  // Static Analysis Complete -> Decides to proceed to Execution or report failures
  messageBus.subscribe(EVENTS.STATIC_ANALYSIS_COMPLETE, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    run.validationScore = payload.validationScore;
    console.log(`[Orchestrator] Static analysis complete. Score: ${payload.validationScore}/10.`);

    if (!payload.passed) {
      console.error(`[Orchestrator] Static check FAILED. Blocking execution. Issues:`, payload.issues);
      // Trigger issue
      await messageBus.publish(EVENTS.ISSUE_REQUESTED, {
        runId: run.runId,
        domain: run.domain,
        title: 'Static validation failure',
        body: JSON.stringify(payload.issues, null, 2),
        labels: ['static_check_failed']
      });
      shutdownRun(run.runId, 'failed_static_validation');
      return;
    }

    // Next step: Runtime execution and analysis
    await messageBus.publish(EVENTS.RUNTIME_ANALYSIS_REQUESTED, {
      runId: run.runId,
      domain: run.domain,
      scenarioType: run.scenarioType,
      scriptPath: run.scriptPath
    });
  });

  // Test Executed -> Determine success / initiate Healing Queue
  messageBus.subscribe(EVENTS.TEST_EXECUTED, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    if (payload.success) {
      console.log(`[Orchestrator] Test execution PASSED! Proceeding to Push Decision Council.`);
      run.success = true;
      run.healingAttempts = 0;
      
      // Next step: Push Decision Council
      await messageBus.publish(EVENTS.PUSH_REVIEW_REQUESTED, {
        runId: run.runId,
        domain: run.domain,
        scenarioType: run.scenarioType,
        scriptPath: run.scriptPath,
        validationScore: run.validationScore,
        healingAttempts: 0,
        success: true
      });
    } else {
      console.warn(`[Orchestrator] Test execution FAILED. Diagnostic message: ${payload.errorMessage}`);
      run.success = false;
      
      if (payload.isFixable) {
        console.log(`[Orchestrator] Failure marked as fixable. Requesting healing loop...`);
        // Next step: Async Healing Queue
        await messageBus.publish(EVENTS.HEALING_REQUESTED, {
          runId: run.runId,
          domain: run.domain,
          scenarioType: run.scenarioType,
          scriptPath: run.scriptPath,
          originalScript: payload.scriptContent,
          errorMessage: payload.errorMessage,
          attempt: 1
        });
      } else {
        console.error(`[Orchestrator] Failure marked as unfixable. Aborting.`);
        await messageBus.publish(EVENTS.ISSUE_REQUESTED, {
          runId: run.runId,
          domain: run.domain,
          title: 'Unfixable runtime error',
          body: payload.errorMessage,
          labels: ['unfixable_failure']
        });
        shutdownRun(run.runId, 'failed_unfixable');
      }
    }
  });

  // Healing Complete -> Trigger Push Review
  messageBus.subscribe(EVENTS.HEALING_COMPLETE, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    console.log(`[Orchestrator] Healing loop complete! Test succeeded on attempt ${payload.attempt}.`);
    run.success = true;
    run.healingAttempts = payload.attempt;

    // Next step: Push Decision Council
    await messageBus.publish(EVENTS.PUSH_REVIEW_REQUESTED, {
      runId: run.runId,
      domain: run.domain,
      scenarioType: run.scenarioType,
      scriptPath: run.scriptPath,
      validationScore: run.validationScore,
      healingAttempts: payload.attempt,
      success: true
    });
  });

  // Healing Failed -> Log issue and shutdown
  messageBus.subscribe(EVENTS.HEALING_FAILED, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    console.error(`[Orchestrator] Healing loop exhausted. Script remains broken.`);
    await messageBus.publish(EVENTS.ISSUE_REQUESTED, {
      runId: run.runId,
      domain: run.domain,
      title: 'Healing exhausted failure',
      body: payload.error,
      labels: ['healing_exhausted']
    });
    shutdownRun(run.runId, 'failed_healing');
  });

  // Push Decision Made -> Execute Git Push or skip
  messageBus.subscribe(EVENTS.PUSH_DECISION_MADE, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    run.pushDecision = payload.shouldPush ? 'pushed' : 'skipped';
    console.log(`[Orchestrator] Push Decision Council finished: ${payload.shouldPush ? 'APPROVED' : 'REJECTED'}. Reason: ${payload.reason}`);

    if (payload.shouldPush) {
      // Next step: Git Push
      await messageBus.publish(EVENTS.PUSH_REQUESTED, {
        runId: run.runId,
        scriptPath: run.scriptPath
      });
    } else {
      shutdownRun(run.runId, 'skipped');
    }
  });

  // Push Complete -> Finalize run and print report
  messageBus.subscribe(EVENTS.PUSH_COMPLETE, async (payload) => {
    const run = activeRuns.get(payload.runId);
    if (!run) return;

    if (payload.success) {
      console.log(`[Orchestrator] Git Push SUCCESS. Script is active in master branch.`);
      shutdownRun(run.runId, 'pushed');
    } else {
      console.error(`[Orchestrator] Git Push FAILED: ${payload.error}`);
      shutdownRun(run.runId, 'git_push_failed');
    }
  });
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
      scenarioTypes: [run.scenarioType],
      totalTests: 1,
      passedTests: run.success ? 1 : 0,
      failedTests: run.success ? 0 : 1,
      healingAttempts: run.healingAttempts || 0,
      modelUsed: 'gpt-4o-mini',
      fallbackUsed: false,
      pushDecision: run.pushDecision || 'skipped',
      durationMs,
      coldStart: run.coldStart
    });
    console.log('[Orchestrator] Run history recorded to PostgreSQL.');
  } catch (err) {
    console.error('[Orchestrator Error] Failed to write run history:', err.message);
  }

  // Trigger background pattern miner to distill failure patterns if there were any issues
  if (run.healingAttempts > 0 || outcome === 'failed_healing') {
    console.log('[Orchestrator] Triggering background pattern mining job...');
    await messageBus.publish(EVENTS.PATTERN_MINED, {});
  }

  activeRuns.delete(runId);

  // If there are no more active runs, wait a second and disconnect clients
  if (activeRuns.size === 0) {
    setTimeout(async () => {
      console.log('\n[Orchestrator] Gracefully shutting down connections...');
      await healingWorker.close();
      await gitAgent.close();
      await memoryAgent.disconnect();
      await messageBus.disconnect();
      console.log('[Orchestrator] System stopped.');
      process.exit(outcome === 'pushed' || outcome === 'skipped' ? 0 : 1);
    }, 1500);
  }
}

async function start(prompt) {
  await bootstrap();

  const runId = uuidv4();
  activeRuns.set(runId, {
    runId,
    prompt,
    startTime: Date.now(),
    success: false,
    healingAttempts: 0
  });

  console.log(`\n[Orchestrator] Starting run: ${runId}`);
  console.log(`[Orchestrator] Publishing plan.requested event.`);
  
  await messageBus.publish(EVENTS.PLAN_REQUESTED, {
    runId,
    prompt
  });
}

// Read prompt from arguments
const promptArg = process.argv.slice(2).join(' ');
if (!promptArg) {
  console.error('Error: Please provide a test prompt, e.g. npm start "Test search at https://demo.playwright.dev/todomvc"');
  process.exit(1);
}

start(promptArg).catch(err => {
  console.error('[Orchestrator Fatal Error]', err);
  process.exit(1);
});
