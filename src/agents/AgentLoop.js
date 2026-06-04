import ActionRecorder from '../core/ActionRecorder.js';
import llmClient from '../core/LlmClient.js';
import memoryAgent from './MemoryAgent.js';

class AgentLoop {
  constructor() {
    this.maxSteps = 25;
    this.stepCount = 0;
  }

  async run(plan, mcpBridge) {
    this.stepCount = 0;
    const { runId, domain, scenarioType, targetUrl, prompt, resolvedPathInfo } = plan;
    
    console.log(`[AgentLoop] Starting explore run for ${domain} on URL: ${targetUrl}`);
    
    // Create ActionRecorder for this run
    const recorder = new ActionRecorder(runId, domain, scenarioType, 'explore');

    // 1. Navigate to start URL
    console.log(`[AgentLoop] Navigating to start URL: ${targetUrl}`);
    const initialSnapshot = await mcpBridge.navigate(targetUrl);
    recorder.recordAction('browser_navigate', { url: targetUrl }, initialSnapshot, {
      content: [{ type: 'text', text: `Navigated to ${targetUrl}` }]
    }, 'Start navigation');

    let currentSnapshot = initialSnapshot;
    let isComplete = false;

    // Retrieve active patterns for this scenario
    const patterns = await memoryAgent.getPatternLibrary(scenarioType);
    
    // 2. Loop up to maxSteps
    while (!isComplete && this.stepCount < this.maxSteps) {
      this.stepCount++;
      recorder.incrementCopilotCalls();

      console.log(`[AgentLoop] Step ${this.stepCount}/${this.maxSteps} - Asking Copilot for next action...`);
      
      // Get next action decision from Copilot
      let decision;
      try {
        decision = await this.askCopilotForNextAction({
          intent: prompt,
          currentSnapshot,
          actionHistory: recorder.getHistory(),
          availableTools: mcpBridge.getToolDefinitions(),
          knownPatterns: patterns,
          stepNumber: this.stepCount
        });
      } catch (err) {
        console.error(`[AgentLoop Error] Copilot call failed:`, err);
        throw err;
      }

      console.log(`[AgentLoop] Copilot Decision: ${decision.tool} - Reasoning: "${decision.reasoning}"`);

      // Check if COMPLETE
      if (decision.tool === 'COMPLETE') {
        isComplete = true;
        recorder.markComplete(decision.reasoning);
        console.log(`[AgentLoop] Task marked COMPLETE: ${decision.reasoning}`);
        break;
      }

      // Check if ABORT
      if (decision.tool === 'ABORT') {
        recorder.markComplete(`Aborted: ${decision.reasoning}`);
        throw new Error(`Agent aborted: ${decision.reasoning}`);
      }

      // Execute tool
      if (decision.tool === 'browser_wait_for' && decision.args && typeof decision.args.time === 'number' && decision.args.time > 100) {
        console.log(`[AgentLoop Check] Converting wait time ${decision.args.time} seconds to ${decision.args.time / 1000} seconds (assuming milliseconds was intended).`);
        decision.args.time = decision.args.time / 1000;
      }

      // Intercept screenshots & snapshots to place them in correct structured folders under test-results/
      if (resolvedPathInfo && (decision.tool === 'browser_screenshot' || decision.tool === 'browser_take_screenshot' || decision.tool === 'browser_snapshot')) {
        const exploreOutputDir = resolvedPathInfo.dir.replace(/^tests/, 'test-results').replace(/\\/g, '/');
        try {
          const fs = await import('fs/promises');
          await fs.mkdir(exploreOutputDir, { recursive: true });
          
          if (decision.args) {
            // Force fullPage to false during explore runs to prevent timeouts on heavy pages
            if (decision.tool === 'browser_screenshot' || decision.tool === 'browser_take_screenshot') {
              decision.args.fullPage = false;
            }

            if (decision.args.filename) {
              const basename = decision.args.filename.replace(/^.*[\\/]/, '');
              decision.args.filename = `${exploreOutputDir}/${basename}`;
            } else if (decision.args.path) {
              const basename = decision.args.path.replace(/^.*[\\/]/, '');
              decision.args.path = `${exploreOutputDir}/${basename}`;
            }
          }
        } catch (err) {
          console.error(`[AgentLoop Warning] Failed to ensure explore output dir exist: ${err.message}`);
        }
      }

      console.log(`[AgentLoop] Executing tool ${decision.tool} with args:`, decision.args);
      let result;
      try {
        result = await mcpBridge.callTool(decision.tool, decision.args);
        if (result && result.isError) {
          throw new Error(result.content?.[0]?.text || 'Tool reported an error');
        }
      } catch (err) {
        console.error(`[AgentLoop Warning] Tool execution failed: ${err.message}. Logging failure step.`);
        recorder.recordAction(decision.tool, decision.args, currentSnapshot, {
          content: [{ type: 'text', text: `Error: ${err.message}` }]
        }, `FAILED: ${decision.reasoning}`);
        
        // Let the loop continue so Copilot can self-correct
        continue;
      }

      // Optimization: Only fetch snapshot if the page could have mutated (i.e. not just screenshot tool)
      let updatedSnapshot = currentSnapshot;
      if (decision.tool !== 'browser_screenshot') {
        updatedSnapshot = await mcpBridge.getSnapshot();
      }

      // Record step details
      recorder.recordAction(decision.tool, decision.args, updatedSnapshot, result, decision.reasoning);
      
      currentSnapshot = updatedSnapshot;
    }

    if (!isComplete && this.stepCount >= this.maxSteps) {
      throw new Error(`Agent exceeded max steps limit (${this.maxSteps}). Task did not complete.`);
    }

    return recorder.getCompleteLog();
  }

  async askCopilotForNextAction(context) {
    const prompt = this.buildDecisionPrompt(context);
    const raw = await llmClient.ask(prompt);
    return this.parseDecision(raw);
  }

  buildDecisionPrompt(context) {
    const { intent, currentSnapshot, actionHistory, availableTools, knownPatterns, stepNumber } = context;

    // Truncate snapshot to 3000 chars for token budget management
    const snapshotForPrompt = currentSnapshot.length > 3000
      ? currentSnapshot.substring(0, 3000) + '\n[...truncated for length]'
      : currentSnapshot;

    // Format action history (last 5 steps only for prompt size management)
    const recentHistory = actionHistory.slice(-5).map(a => 
      `Step ${a.step}: Called ${a.tool}(${JSON.stringify(a.args)}) -> ${a.result || 'success'}`
    ).join('\n');

    const toolsList = availableTools.map(t => {
      let paramDesc = '';
      if (t.parameters && t.parameters.properties) {
        const paramsList = Object.entries(t.parameters.properties).map(([name, schema]) => {
          const typeStr = schema.type ? ` (${schema.type})` : '';
          const descStr = schema.description ? `: ${schema.description}` : '';
          return `${name}${typeStr}${descStr}`;
        });
        if (paramsList.length > 0) {
          paramDesc = ` (Parameters: ${paramsList.join(', ')})`;
        }
      }
      return `- ${t.name}: ${t.description}.${paramDesc}`;
    }).join('\n');
    const patternsSection = knownPatterns && knownPatterns.length > 0
      ? `KNOWN ACCESSIBILITY PATTERNS:\n${knownPatterns.map(p => `- ${p.rule}`).join('\n')}\n`
      : '';

    return `You are a browser test automation agent executing step ${stepNumber}/25.

TASK: ${intent}

AVAILABLE TOOLS:
${toolsList}
Special responses: COMPLETE (task done), ABORT (task impossible)

CURRENT PAGE STATE (Accessibility Snapshot):
${snapshotForPrompt}

RECENT ACTIONS TAKEN:
${recentHistory || 'None yet'}

${patternsSection}
RULES:
1. Output ONLY a single JSON object – no explanation outside JSON.
2. Choose ONE action that moves toward completing the task.
3. Use the exact ref ID value from the snapshot (e.g. "e8" or "e15") as the target parameter value. Do NOT use CSS selectors or locator queries like "textbox" or "input". Use only the ref ID string.
4. If the task appears complete, use COMPLETE.
5. If the task is impossible (element not found after navigating, or page 404), use ABORT.
6. Never repeat an action that already succeeded.
7. If an overlay banner or pre-content pop-up (e.g., rebrand banners, cookies, sign-in alerts) intercepts your clicks or covers page elements, prioritize clicking the "DismissBanner" or "Close" button first to clear it out of the way.
8. SHADOW DOM / WEB COMPONENTS: Many pages (like MSN) use Web Components and Shadow DOM. Standard document.querySelector/querySelectorAll inside browser_evaluate will return null for elements inside shadow roots. When using browser_evaluate to check elements, write functions that recursively search shadow roots (e.g. piercing shadow DOM) to find elements, or locate them using their visible text or by checking if a parent container has children.

RESPOND WITH THIS JSON FORMAT ONLY:
{
  "tool": "tool_name_or_COMPLETE_or_ABORT",
  "args": { ... }, // key-value pairs matching the chosen tool's parameters, e.g. {"target": "e8", "text": "Homework"} or {"url": "..."}
  "reasoning": "one sentence why"
}`;
  }

  parseDecision(rawResponse) {
    const firstBrace = rawResponse.indexOf('{');
    const lastBrace = rawResponse.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('Copilot response did not contain valid JSON decision');
    }

    const jsonText = rawResponse.substring(firstBrace, lastBrace + 1);

    try {
      const decision = JSON.parse(jsonText);
      if (!decision.tool) {
        throw new Error('Decision missing tool field');
      }
      if (!decision.args && decision.tool !== 'COMPLETE' && decision.tool !== 'ABORT') {
        decision.args = {};
      }
      return decision;
    } catch (err) {
      throw new Error(`Failed to parse JSON decision: ${err.message}. Raw: ${rawResponse}`);
    }
  }
}

const agentLoop = new AgentLoop();
export default agentLoop;
