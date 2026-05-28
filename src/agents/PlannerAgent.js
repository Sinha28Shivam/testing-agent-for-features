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
          coldStart: true,
          useCache: false,
          specialist: 'GenericGeneratorAgent',
          complexity: 5,
          checklist: ['Navigate to target URL', 'Perform test case validation'],
          agents: ['DOMWorker', 'SpecialistGeneratorAgent', 'StaticAnalyzerAgent', 'RuntimeAnalyzerAgent', 'PushDecisionCouncil']
        };
        await messageBus.publish(EVENTS.PLAN_CREATED, fallbackPlan);
      }
    });

    this.initialized = true;
    console.log('[PlannerAgent] Subscribed to plan.requested.');
  }

  async createPlan(runId, prompt) {
    console.log('[PlannerAgent] Parsing prompt using local heuristics...');
    
    // 1. Extract Target URL
    const urlRegex = /(https?:\/\/[^\s"'`\)]+)/gi;
    const urlMatch = urlRegex.exec(prompt);
    let targetUrl = 'https://demo.playwright.dev/todomvc';
    if (urlMatch) {
      targetUrl = urlMatch[1];
    } else {
      const wwwRegex = /(www\.[^\s"'`\)]+)/gi;
      const wwwMatch = wwwRegex.exec(prompt);
      if (wwwMatch) {
        targetUrl = `https://${wwwMatch[1]}`;
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

    // 4. Generate Checklist
    const checklist = [];
    checklist.push(`Navigate to ${targetUrl}`);
    
    // Extract actions from user instructions
    if (lowerPrompt.includes('add a todo') || lowerPrompt.includes('add todo')) {
      checklist.push("Add a todo item 'Buy Milk'");
      checklist.push("Verify 'Buy Milk' is added to the list");
    } else if (lowerPrompt.includes('search for') || lowerPrompt.includes('query')) {
      checklist.push("Enter search query in the search bar");
      checklist.push("Submit search and verify results are displayed");
    } else {
      checklist.push("Verify that the target page loaded successfully");
      checklist.push("Assert the main container is visible");
    }

    console.log(`[PlannerAgent] Local heuristics parsed: Domain=${domain}, URL=${targetUrl}, Scenario=${scenarioType}, ActionsCount=${checklist.length}`);

    // Query MemoryAgent for site history
    await memoryAgent.connect();
    const siteProfile = await memoryAgent.getSiteProfile(domain);

    let coldStart = true;
    let useCache = false;
    let shadowDom = false;
    let authRequired = false;

    if (siteProfile) {
      coldStart = false;
      shadowDom = siteProfile.shadow_dom;
      authRequired = siteProfile.auth_required;
      
      // Cache can be used if last run was in the last 2 hours (7200000 ms)
      const lastRun = siteProfile.last_run_at ? new Date(siteProfile.last_run_at).getTime() : 0;
      const now = Date.now();
      if (now - lastRun < 7200000 && siteProfile.volatility !== 'high') {
        useCache = true;
      }
    }

    // Determine the specialist agent
    let specialist = 'GenericGeneratorAgent';
    if (scenarioType === 'authentication' || authRequired) {
      specialist = 'AuthSpecialistAgent';
    } else if (shadowDom) {
      specialist = 'ShadowDOMSpecialistAgent';
    } else if (scenarioType === 'search') {
      specialist = 'SearchSpecialistAgent';
    }

    // Create execution plan
    const plan = {
      runId,
      prompt,
      domain,
      scenarioType,
      targetUrl,
      complexity: 5,
      checklist,
      coldStart,
      useCache,
      specialist,
      agents: [
        'DOMWorker',
        'SpecialistGeneratorAgent',
        'StaticAnalyzerAgent',
        'RuntimeAnalyzerAgent',
        'PushDecisionCouncil'
      ]
    };

    console.log('[PlannerAgent] Execution plan created:', plan);
    return plan;
  }
}

const plannerAgent = new PlannerAgent();
export default plannerAgent;
