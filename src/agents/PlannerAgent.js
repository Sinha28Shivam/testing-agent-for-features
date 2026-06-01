import messageBus, { EVENTS } from '../core/MessageBus.js';
import memoryAgent from './MemoryAgent.js';

class PlannerAgent {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    await messageBus.subscribe(EVENTS.PLAN_REQUESTED, async (payload) => {
      console.log(`[PlannerAgent] Received PLAN_REQUESTED event with prompt: "${payload.prompt}"`);
      try {
        const plan = await this.createPlan(payload.runId, payload.prompt);
        await messageBus.publish(EVENTS.PLAN_CREATED, plan);
      } catch (err) {
        console.error(`[PlannerAgent Error] Failed to create plan:`, err);
        // Fallback simple plan
        const fallbackPlan = {
          runId: payload.runId,
          prompt: payload.prompt,
          domain: 'unknown',
          scenarioType: 'navigation',
          targetUrl: 'https://demo.playwright.dev/todomvc',
          executionMode: 'explore',
          storedSequence: null,
          coldStart: true,
          checklist: ['Navigate to target URL']
        };
        await messageBus.publish(EVENTS.PLAN_CREATED, fallbackPlan);
      }
    });

    this.initialized = true;
    console.log('[PlannerAgent] Subscribed to plan.requested.');
  }

  async createPlan(runId, prompt) {
    console.log('[PlannerAgent] Parsing prompt using heuristics...');
    
    // 1. Extract Target URL
    const urlRegex = /(https?:\/\/[^\s"'`\)]+)/gi;
    const urlMatch = urlRegex.exec(prompt);
    let targetUrl = 'https://demo.playwright.dev/todomvc';
    if (urlMatch) {
      targetUrl = urlMatch[1].replace(/[,.]$/, '');
    } else {
      const wwwRegex = /(www\.[^\s"'`\)]+)/gi;
      const wwwMatch = wwwRegex.exec(prompt);
      if (wwwMatch) {
        targetUrl = `https://${wwwMatch[1]}`.replace(/[,.]$/, '');
      }
    }

    // 2. Extract Domain
    let domain = 'unknown';
    try {
      const parsedUrl = new URL(targetUrl);
      domain = parsedUrl.hostname;
    } catch (e) {
      // Fallback
    }

    // 3. Determine Scenario Type
    let scenarioType = 'navigation';
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('login') || lowerPrompt.includes('signin') || lowerPrompt.includes('auth') || lowerPrompt.includes('register') || lowerPrompt.includes('signup')) {
      scenarioType = 'authentication';
    } else if (lowerPrompt.includes('search') || lowerPrompt.includes('find') || lowerPrompt.includes('query')) {
      scenarioType = 'search';
    } else if (lowerPrompt.includes('form') || lowerPrompt.includes('input') || lowerPrompt.includes('submit') || lowerPrompt.includes('fill')) {
      scenarioType = 'form';
    }

    // 4. Generate Heuristic Checklist
    const checklist = [];
    checklist.push(`Navigate to ${targetUrl}`);
    if (lowerPrompt.includes('add a todo') || lowerPrompt.includes('add todo') || lowerPrompt.includes('task')) {
      checklist.push("Add a todo item");
      checklist.push("Verify todo item is added");
    } else if (lowerPrompt.includes('search') || lowerPrompt.includes('query')) {
      checklist.push("Enter search query");
      checklist.push("Verify search results");
    } else {
      checklist.push("Verify that target page loaded successfully");
    }

    // Connect memoryAgent to query domain profiles and action sequences
    await memoryAgent.connect();
    
    // Check if we have a verified sequence in database for this domain + scenarioType
    const sequence = await memoryAgent.getActionSequence(domain, scenarioType);
    
    let executionMode = 'explore';
    let storedSequence = null;
    let coldStart = true;

    if (sequence) {
      coldStart = false;
      // Replay only if verified
      if (sequence.state === 'verified') {
        executionMode = 'replay';
        storedSequence = sequence.sequence;
        console.log(`[PlannerAgent] Verified sequence found. Setting mode to REPLAY.`);
      } else {
        console.log(`[PlannerAgent] Sequence found but in state '${sequence.state}'. Setting mode to EXPLORE.`);
      }
    } else {
      console.log(`[PlannerAgent] No sequence found for domain ${domain} and scenario ${scenarioType}. Setting mode to EXPLORE (cold start).`);
    }

    // Create execution plan
    const plan = {
      runId,
      prompt,
      domain,
      scenarioType,
      targetUrl,
      executionMode,
      storedSequence,
      coldStart,
      checklist
    };

    console.log('[PlannerAgent] Plan successfully created:', plan);
    return plan;
  }
}

const plannerAgent = new PlannerAgent();
export default plannerAgent;
