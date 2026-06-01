import messageBus, { EVENTS } from '../core/MessageBus.js';
import llmClient from '../core/LlmClient.js';

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

    console.log('[PushDecisionCouncil] Deliberating push decision in a single consolidated Copilot call...');
    const prompt = `You are the Push Decision Council consisting of three agents:
1. ConservativeReviewerAgent: Find reasons NOT to push this generated test script (focus on risks, code smell, instability).
2. OptimisticReviewerAgent: Highlight the benefits, testing value, and code quality.
3. ArbiterAgent: Make the final decision. Approve only if stable, clean, and reliable.

CONTEXT:
- Domain: ${domain}
- Scenario Type: ${scenarioType}
- Validation Score: ${validationScore}/10
- Healing Attempts: ${healingAttempts}

RESPOND WITH THIS JSON FORMAT ONLY:
{
  "conservativeReview": "under 100 words paragraph focusing on risks",
  "optimisticReview": "under 100 words paragraph focusing on benefits",
  "decision": {
    "approved": true or false,
    "confidence": 0.0 to 1.0,
    "reason": "brief summary of the final choice"
  }
}`;

    const deliberation = await llmClient.askJson(prompt);
    console.log('[PushDecisionCouncil] Deliberation results:', deliberation);

    const approved = deliberation.decision?.approved || false;
    const confidence = deliberation.decision?.confidence || 0.5;
    const reason = deliberation.decision?.reason || 'No reason provided by Arbiter.';

    return {
      runId,
      domain,
      shouldPush: approved,
      confidence,
      reason: `[Arbiter] Approved: ${approved}. Reason: ${reason}. (Consolidated Reviews: Conservative: "${deliberation.conservativeReview}" | Optimistic: "${deliberation.optimisticReview}")`
    };
  }
}

const pushDecisionCouncil = new PushDecisionCouncil();
export default pushDecisionCouncil;
