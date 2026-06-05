import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
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
        const plan = await this.createPlan(payload.runId, payload.prompt, payload.name);
        await messageBus.publish(EVENTS.PLAN_CREATED, plan);
      } catch (err) {
        console.error(`[PlannerAgent Error] Failed to create plan:`, err);
        try {
          const fallbackPlan = await this.createFallbackPlan(payload.runId, payload.prompt, payload.name);
          await messageBus.publish(EVENTS.PLAN_CREATED, fallbackPlan);
        } catch (fallbackErr) {
          console.error(`[PlannerAgent Error] Failed to create fallback plan:`, fallbackErr);
        }
      }
    });

    this.initialized = true;
    console.log('[PlannerAgent] Subscribed to plan.requested.');
  }

  async createPlan(runId, prompt, name = null) {
    console.log('[PlannerAgent] Parsing prompt using heuristics...');
    
    // 1. Extract Target URL
    const targetUrl = await this.resolveTargetUrl(prompt);
    if (!targetUrl) {
      throw new Error('No target URL found in prompt. Add a URL to the scenario prompt.');
    }

    // 2. Extract Domain
    const domain = this.extractDomain(targetUrl);

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
      name,
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

  async createFallbackPlan(runId, prompt, name = null) {
    const targetUrl = await this.resolveTargetUrl(prompt);
    if (!targetUrl) {
      throw new Error('Fallback planning failed because no target URL was found in prompt.');
    }

    const domain = this.extractDomain(targetUrl);

    return {
      runId,
      name: name || null,
      prompt,
      domain,
      scenarioType: this.inferScenarioType(prompt),
      targetUrl,
      executionMode: 'explore',
      storedSequence: null,
      coldStart: true,
      checklist: [`Navigate to ${targetUrl}`, 'Verify that target page loaded successfully']
    };
  }

  async resolveTargetUrl(prompt = '') {
    // 1. Literal URL check
    const literalUrl = this.extractTargetUrl(prompt);
    if (literalUrl) {
      return literalUrl;
    }

    console.log(`[PlannerAgent] No literal URL found in prompt. Attempting dynamic resolution...`);

    const lowerPrompt = prompt.toLowerCase();

    // 2. Try to find a URL from other scenarios in scenarios.yaml
    try {
      const yamlPath = path.resolve('scenarios.yaml');
      const fileContent = await fs.readFile(yamlPath, 'utf-8');
      const parsed = yaml.load(fileContent);
      if (parsed && Array.isArray(parsed.scenarios)) {
        for (const s of parsed.scenarios) {
          if (!s.prompt) continue;
          const u = this.extractTargetUrl(s.prompt);
          if (u) {
            const domain = this.extractDomain(u);
            const domainBase = domain.replace(/^www\./i, '').split('.')[0];
            if (domainBase && lowerPrompt.includes(domainBase)) {
              console.log(`[PlannerAgent] Dynamically resolved URL from scenarios.yaml: "${u}" for brand "${domainBase}"`);
              return u;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[PlannerAgent] Dynamic resolution from scenarios.yaml failed:`, e.message);
    }

    // 3. Try to find a domain in the database
    try {
      if (!memoryAgent.connected) {
        await memoryAgent.connect();
      }
      const res = await memoryAgent.pgPool.query('SELECT domain FROM domain_profiles');
      for (const row of res.rows) {
        const domain = row.domain;
        const domainBase = domain.replace(/^www\./i, '').split('.')[0];
        if (domainBase && lowerPrompt.includes(domainBase)) {
          const u = `https://${domain}`;
          console.log(`[PlannerAgent] Dynamically resolved URL from domain profiles: "${u}"`);
          return u;
        }
      }
    } catch (e) {
      console.warn(`[PlannerAgent] Dynamic resolution from database failed:`, e.message);
    }

    // 4. Default to first URL found in scenarios.yaml as fallback
    try {
      const yamlPath = path.resolve('scenarios.yaml');
      const fileContent = await fs.readFile(yamlPath, 'utf-8');
      const parsed = yaml.load(fileContent);
      if (parsed && Array.isArray(parsed.scenarios)) {
        for (const s of parsed.scenarios) {
          if (!s.prompt) continue;
          const u = this.extractTargetUrl(s.prompt);
          if (u) {
            console.log(`[PlannerAgent] Using first available URL from scenarios.yaml as fallback: "${u}"`);
            return u;
          }
        }
      }
    } catch (e) {
      // ignore
    }

    // 5. Ultimate fallback
    const ultimateFallback = process.env.DEFAULT_TARGET_URL || 'https://www.msn.com/en-in';
    console.log(`[PlannerAgent] Using ultimate fallback URL: "${ultimateFallback}"`);
    return ultimateFallback;
  }

  extractTargetUrl(prompt = '') {
    const urlRegex = /(https?:\/\/[^\s"'`\)]+)/gi;
    const urlMatch = urlRegex.exec(prompt);
    if (urlMatch) {
      return urlMatch[1].replace(/[,.]$/, '');
    }

    const wwwRegex = /(www\.[^\s"'`\)]+)/gi;
    const wwwMatch = wwwRegex.exec(prompt);
    if (wwwMatch) {
      return `https://${wwwMatch[1]}`.replace(/[,.]$/, '');
    }

    return null;
  }

  extractDomain(targetUrl) {
    try {
      const parsedUrl = new URL(targetUrl);
      return parsedUrl.hostname;
    } catch (e) {
      return 'unknown';
    }
  }

  inferScenarioType(prompt = '') {
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('login') || lowerPrompt.includes('signin') || lowerPrompt.includes('auth') || lowerPrompt.includes('register') || lowerPrompt.includes('signup')) {
      return 'authentication';
    }
    if (lowerPrompt.includes('search') || lowerPrompt.includes('find') || lowerPrompt.includes('query')) {
      return 'search';
    }
    if (lowerPrompt.includes('form') || lowerPrompt.includes('input') || lowerPrompt.includes('submit') || lowerPrompt.includes('fill')) {
      return 'form';
    }
    return 'navigation';
  }
}

const plannerAgent = new PlannerAgent();
export default plannerAgent;
