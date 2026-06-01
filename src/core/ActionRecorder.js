/**
 * ActionRecorder tracks the step-by-step history of browser sessions.
 * It compiles logs for MongoDB and extracts distilled replay sequences for PostgreSQL.
 */
class ActionRecorder {
  constructor(runId, domain, scenarioType, executionMode = 'explore') {
    this.runId = runId;
    this.domain = domain;
    this.scenarioType = scenarioType;
    this.executionMode = executionMode;
    this.actions = [];
    this.startTime = Date.now();
    this.completed = false;
    this.completionReason = null;
    this.copilotCallsUsed = 0;
  }

  // Record an action step and its outcomes
  recordAction(tool, args, snapshotAfter, result = null, reasoning = null) {
    this.actions.push({
      step: this.actions.length + 1,
      tool,
      args,
      result: result ? this.extractResultText(result) : null,
      snapshotAfter, // Accessibility tree after step execution
      reasoning,
      timestamp: Date.now()
    });
  }

  markComplete(reason) {
    this.completed = true;
    this.completionReason = reason;
  }

  incrementCopilotCalls() {
    this.copilotCallsUsed++;
  }

  // Get condensed action history for Copilot context (last 5 steps, older steps truncated)
  getHistory() {
    return this.actions.map((a, i) => {
      const isRecent = i >= this.actions.length - 3;
      return {
        step: a.step,
        tool: a.tool,
        args: a.args,
        reasoning: a.reasoning,
        result: a.result,
        // Include full snapshot only for the last 3 steps to conserve tokens
        snapshot: isRecent ? a.snapshotAfter : '[truncated]'
      };
    });
  }

  // Format log for MongoDB
  getCompleteLog() {
    return {
      runId: this.runId,
      domain: this.domain,
      scenarioType: this.scenarioType,
      executionMode: this.executionMode,
      actions: this.actions,
      totalSteps: this.actions.length,
      durationMs: Date.now() - this.startTime,
      completed: this.completed,
      completionReason: this.completionReason,
      copilotCallsUsed: this.copilotCallsUsed
    };
  }

  // Distill the sequence for PostgreSQL replay and learning (domain learning)
  getStorableView() {
    return this.actions.map(a => {
      const step = {
        tool: a.tool,
        args: { ...a.args }
      };

      // Mask sensitive credentials
      if (a.tool === 'browser_fill') {
        const lowerSelector = (a.args.selector || '').toLowerCase();
        const value = a.args.value || '';
        
        if (lowerSelector.includes('email') || lowerSelector.includes('username') || value.includes('@')) {
          step.valueType = 'email';
          delete step.args.value;
        } else if (lowerSelector.includes('password') || lowerSelector.includes('pass') || lowerSelector.includes('pwd')) {
          step.valueType = 'password';
          delete step.args.value;
        }
      }

      return step;
    });
  }

  // Extract plain text from MCP tool result content
  extractResultText(result) {
    if (!result || !result.content) return null;
    return result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
      .substring(0, 500);
  }
}

export default ActionRecorder;
