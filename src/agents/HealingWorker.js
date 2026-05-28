import { Queue, Worker } from 'bullmq';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import messageBus, { EVENTS } from '../core/MessageBus.js';
import memoryAgent from './MemoryAgent.js';
import llmClient from '../core/LlmClient.js';
import promptLoader from '../config/PromptLoader.js';

dotenv.config();

const redisUrl = process.env.REDIS_URI || 'redis://localhost:6379';
const connectionOpts = {
  host: new URL(redisUrl).hostname,
  port: parseInt(new URL(redisUrl).port || '6379', 10)
};

class HealingWorker {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await memoryAgent.connect();

    // 1. Initialize BullMQ Queue
    this.queue = new Queue('healing-queue', { connection: connectionOpts });
    console.log('[HealingWorker] BullMQ queue "healing-queue" initialized.');

    // 2. Initialize BullMQ Worker
    this.worker = new Worker('healing-queue', async (job) => {
      console.log(`[HealingWorker] Processing healing job: ${job.id} (Attempt ${job.data.attempt})`);
      return await this.processHealing(job.data);
    }, { connection: connectionOpts, concurrency: 1 });

    this.worker.on('failed', (job, err) => {
      console.error(`[HealingWorker Error] Job ${job?.id} failed:`, err);
    });

    // 3. Subscribe to HEALING_REQUESTED event on message bus
    await messageBus.subscribe(EVENTS.HEALING_REQUESTED, async (payload) => {
      console.log(`[HealingWorker] Event HEALING_REQUESTED received for ${payload.scriptPath}`);
      await this.queue.add(`heal_${payload.runId}_att_${payload.attempt}`, {
        runId: payload.runId,
        domain: payload.domain,
        scenarioType: payload.scenarioType,
        scriptPath: payload.scriptPath,
        originalScript: payload.originalScript,
        errorMessage: payload.errorMessage,
        attempt: payload.attempt || 1
      });
    });

    this.initialized = true;
    console.log('[HealingWorker] Subscribed to healing.requested and started queue worker.');
  }

  async processHealing(data) {
    const { runId, domain, scenarioType, scriptPath, originalScript, errorMessage, attempt } = data;
    
    console.log(`[HealingWorker] Running Healing Attempt ${attempt}...`);

    // Get latest DOM snapshot context for the LLM
    const snapshot = await memoryAgent.getLatestDomSnapshot(domain);
    const elementsList = snapshot ? JSON.stringify(snapshot.elements.slice(0, 50).map(e => ({
      tagName: e.tagName,
      id: e.id,
      className: e.className,
      placeholder: e.placeholder,
      innerText: e.innerText
    }))) : 'No DOM snapshot context available.';

    // Load healing prompt from YAML configuration
    const promptTemplate = await promptLoader.getPrompt('healing', 'heal');
    const healingPrompt = promptTemplate
      .replaceAll('{scriptPath}', scriptPath)
      .replaceAll('{originalScript}', originalScript)
      .replaceAll('{errorMessage}', errorMessage)
      .replaceAll('{elementsList}', elementsList);

    const rawResponse = await llmClient.ask(healingPrompt);
    
    // Extract code block
    let healedScript = '';
    const match = rawResponse.match(/```(?:javascript|js)\s*([\s\S]*?)\s*```/);
    if (match) {
      healedScript = match[1].trim();
    } else {
      healedScript = rawResponse.trim();
    }

    if (!healedScript.includes("test(") && !healedScript.includes("expect(")) {
      throw new Error("AI failed to output a valid healed Playwright test script.");
    }

    // Write healed script back to the file system
    await fs.writeFile(scriptPath, healedScript, 'utf-8');
    console.log(`[HealingWorker] Wrote healed script to: ${scriptPath}`);

    // Re-verify by running the test
    console.log(`[HealingWorker] Re-running script to verify healing...`);
    const { success, stdout, stderr, exitCode } = await this.runTest(scriptPath);

    if (success) {
      console.log(`[HealingWorker] SUCCESS! Script healed successfully on attempt ${attempt}.`);
      
      // Update SelectorRegistry with success
      await messageBus.publish(EVENTS.HEALING_COMPLETE, {
        runId,
        domain,
        scenarioType,
        scriptPath,
        attempt,
        success: true,
        scriptContent: healedScript
      });

      // Log success in failure_log
      await memoryAgent.writeFailureLog({
        runId,
        domain,
        scenarioType,
        testTitle: 'Healed script run',
        errorType: null,
        errorMessage: null,
        selectorUsed: null,
        fixAttempted: `Attempt ${attempt}`,
        fixSucceeded: true,
        healingAttemptNumber: attempt,
        coldStart: false
      });

      return { success: true };
    } else {
      console.warn(`[HealingWorker] Test still failed on attempt ${attempt} (Exit code: ${exitCode})`);
      const combinedOutput = `${stdout}\n\n${stderr}`;
      const newErrorMessage = combinedOutput.substring(0, 500);

      // Log failure attempt in failure_log
      await memoryAgent.writeFailureLog({
        runId,
        domain,
        scenarioType,
        testTitle: 'Healing verification failed',
        errorType: 'assertion',
        errorMessage: newErrorMessage,
        selectorUsed: null,
        fixAttempted: `Attempt ${attempt}`,
        fixSucceeded: false,
        healingAttemptNumber: attempt,
        coldStart: false
      });

      if (attempt < 3) {
        // Enqueue next attempt
        console.log(`[HealingWorker] Enqueueing next healing attempt: ${attempt + 1}`);
        await messageBus.publish(EVENTS.HEALING_REQUESTED, {
          runId,
          domain,
          scenarioType,
          scriptPath,
          originalScript: healedScript, // Use this version for next attempt
          errorMessage: newErrorMessage,
          attempt: attempt + 1
        });
      } else {
        console.error(`[HealingWorker] FAILED! Exceeded maximum healing attempts (3).`);
        await messageBus.publish(EVENTS.HEALING_FAILED, {
          runId,
          domain,
          scenarioType,
          scriptPath,
          error: newErrorMessage
        });
      }

      return { success: false, error: newErrorMessage };
    }
  }

  runTest(scriptPath) {
    return new Promise((resolve) => {
      const child = spawn('npx', ['playwright', 'test', scriptPath]);
      
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

  async close() {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
  }
}

const healingWorker = new HealingWorker();
export default healingWorker;
