import messageBus, { EVENTS } from '../core/MessageBus.js';
import llmClient from '../core/LlmClient.js';
import promptLoader from '../config/PromptLoader.js';

class PushDecisionCouncil {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await messageBus.subscribe(EVENTS.PUSH_REVIEW_REQUESTED, async (payload) => {
      console.log(`[PushDecisionCouncil] Deliberation requested for domain ${payload.domain}...`);
      try {
        const decision = await this.deliberate(payload);
        await messageBus.publish(EVENTS.PUSH_DECISION_MADE, decision);
      } catch (err) {
        console.error('[PushDecisionCouncil Error] Deliberation failed:', err);
        await messageBus.publish(EVENTS.PUSH_DECISION_MADE, {
          runId: payload.runId,
          domain: payload.domain,
          shouldPush: false,
          reason: `Deliberation crashed: ${err.message}`
        });
      }
    });

    this.initialized = true;
    console.log('[PushDecisionCouncil] Subscribed to push.review.requested.');
  }

  async deliberate(payload) {
    const { runId, domain, scenarioType, scriptPath, validationScore, healingAttempts, success } = payload;

    // Hard Rule: If the test didn't pass, never push.
    if (!success) {
      console.log('[PushDecisionCouncil] Hard Rule Triggered: Execution failed. Push REJECTED.');
      return {
        runId,
        domain,
        shouldPush: false,
        reason: 'Test execution failed. Pushing broken code is blocked.'
      };
    }

    // Hard Rule: If validation score is too low (< 5), never push.
    if (validationScore < 5) {
      console.log('[PushDecisionCouncil] Hard Rule Triggered: Static validation score too low. Push REJECTED.');
      return {
        runId,
        domain,
        shouldPush: false,
        reason: `Static validation score is too low (${validationScore}/10).`
      };
    }

    // Call Conservative Reviewer
    console.log('[PushDecisionCouncil] Invoking ConservativeReviewerAgent...');
    const conservativeReview = await this.getConservativeReview(payload);
    console.log('[PushDecisionCouncil] Conservative Review:\n', conservativeReview);

    // Call Optimistic Reviewer
    console.log('[PushDecisionCouncil] Invoking OptimisticReviewerAgent...');
    const optimisticReview = await this.getOptimisticReview(payload);
    console.log('[PushDecisionCouncil] Optimistic Review:\n', optimisticReview);

    // Arbiter Agent Decides
    console.log('[PushDecisionCouncil] Invoking ArbiterAgent for final decision...');
    const promptTemplate = await promptLoader.getPrompt('push_council', 'arbiter');
    const decisionPrompt = promptTemplate
      .replaceAll('{domain}', domain)
      .replaceAll('{scenarioType}', scenarioType)
      .replaceAll('{validationScore}', validationScore)
      .replaceAll('{healingAttempts}', healingAttempts)
      .replaceAll('{conservativeReview}', conservativeReview)
      .replaceAll('{optimisticReview}', optimisticReview);

    const decision = await llmClient.askJson(decisionPrompt);
    console.log('[PushDecisionCouncil] Arbiter final decision:', decision);

    return {
      runId,
      domain,
      shouldPush: decision.approved || false,
      confidence: decision.confidence || 0.5,
      reason: decision.reason || 'No reason provided by Arbiter.'
    };
  }

  async getConservativeReview(payload) {
    const { domain, validationScore, healingAttempts } = payload;
    const promptTemplate = await promptLoader.getPrompt('push_council', 'conservative');
    const prompt = promptTemplate
      .replaceAll('{domain}', domain)
      .replaceAll('{validationScore}', validationScore)
      .replaceAll('{healingAttempts}', healingAttempts);
    return await llmClient.ask(prompt);
  }

  async getOptimisticReview(payload) {
    const { domain, validationScore, healingAttempts } = payload;
    const promptTemplate = await promptLoader.getPrompt('push_council', 'optimistic');
    const prompt = promptTemplate
      .replaceAll('{domain}', domain)
      .replaceAll('{validationScore}', validationScore)
      .replaceAll('{healingAttempts}', healingAttempts);
    return await llmClient.ask(prompt);
  }
}

const pushDecisionCouncil = new PushDecisionCouncil();
export default pushDecisionCouncil;
