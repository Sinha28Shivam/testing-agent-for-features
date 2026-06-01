/**
 * ReplayExecutor replays a verified sequence of browser actions directly
 * through the MCP server without invoking the LLM, reducing latency and cost.
 */
class ReplayExecutor {
  async execute(storedSequence, mcpBridge) {
    console.log(`[ReplayExecutor] Replaying stored action sequence (${storedSequence.length} steps)...`);
    const executedActions = [];
    
    let stepCount = 0;
    for (const step of storedSequence) {
      stepCount++;
      const resolvedArgs = this.resolveArgs(step);
      console.log(`[ReplayExecutor] Step ${stepCount}: Executing ${step.tool} with args:`, resolvedArgs);
      
      try {
        const result = await mcpBridge.callTool(step.tool, resolvedArgs);
        
        let snapshotAfter = '';
        if (step.tool !== 'browser_screenshot') {
          snapshotAfter = await mcpBridge.getSnapshot();
        }

        executedActions.push({
          step: stepCount,
          tool: step.tool,
          args: resolvedArgs,
          result: result ? this.extractResultText(result) : null,
          snapshotAfter,
          reasoning: 'Replayed action',
          timestamp: Date.now()
        });
      } catch (err) {
        console.error(`[ReplayExecutor Error] Failed at step ${stepCount} (${step.tool}): ${err.message}`);
        return {
          success: false,
          failedAtStep: stepCount,
          reason: err.message,
          actions: executedActions
        };
      }
    }

    return {
      success: true,
      actions: executedActions
    };
  }

  // Resolve placeholders to env variables at runtime
  resolveArgs(storedStep) {
    const args = { ...storedStep.args };
    if (storedStep.valueType === 'email' || storedStep.valueType === 'password') {
      const val = storedStep.valueType === 'email'
        ? (process.env.TEST_EMAIL || 'test@example.com')
        : (process.env.TEST_PASSWORD || 'testpass123');

      if (storedStep.tool === 'browser_type') {
        args.text = val;
      } else {
        args.value = val;
      }
    }
    return args;
  }

  // Helper to extract text from MCP tool results
  extractResultText(result) {
    if (!result || !result.content) return null;
    return result.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
      .substring(0, 500);
  }
}

const replayExecutor = new ReplayExecutor();
export default replayExecutor;
