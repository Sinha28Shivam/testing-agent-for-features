import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import messageBus, { EVENTS } from '../core/MessageBus.js';
import memoryAgent from './MemoryAgent.js';
import llmClient from '../core/LlmClient.js';
import promptLoader from '../config/PromptLoader.js';

class SpecialistGeneratorAgent {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await messageBus.subscribe(EVENTS.SCRIPT_GENERATE_REQUESTED, async (payload) => {
      console.log(`[SpecialistGeneratorAgent] Received request to generate script for domain: ${payload.domain}`);
      try {
        const result = await this.generateScript(payload);
        await messageBus.publish(EVENTS.SCRIPT_GENERATED, result);
      } catch (err) {
        console.error('[SpecialistGeneratorAgent Error] Generation failed:', err);
        await messageBus.publish(EVENTS.SCRIPT_GENERATE_FAILED, {
          runId: payload.runId,
          domain: payload.domain,
          error: err.message
        });
      }
    });

    this.initialized = true;
    console.log('[SpecialistGeneratorAgent] Subscribed to script.generate.requested.');
  }

  async generateScript(payload) {
    const { runId, domain, scenarioType, targetUrl, checklist, snapshot, specialist } = payload;
    
    await memoryAgent.connect();

    // 1. Fetch proven selectors from SelectorRegistry
    const provenSelectors = await memoryAgent.getSelectorsForDomain(domain);
    const selectorContext = provenSelectors.length > 0 
      ? `Proven selectors for this domain:\n${provenSelectors.map(s => `- ${s.intent}: \`${s.selector}\` (${s.selector_type})`).join('\n')}`
      : 'No proven selectors stored for this domain.';

    // 2. Fetch active patterns from PatternLibrary
    const activePatterns = await memoryAgent.getPatternLibrary(scenarioType);
    const patternContext = activePatterns.length > 0
      ? `Applicable design/healing rules:\n${activePatterns.map(p => `- RULE [${p.pattern_key}]: ${p.rule}`).join('\n')}`
      : 'No dynamic pattern rules active.';

    // 3. Prepare DOM context (limit elements to avoid token bloat)
    const domContext = snapshot?.elements 
      ? JSON.stringify(snapshot.elements.slice(0, 50).map(e => ({
          tagName: e.tagName,
          id: e.id,
          className: e.className,
          placeholder: e.placeholder,
          innerText: e.innerText,
          testId: e.testId,
          role: e.role
        })))
      : 'No DOM elements available.';

    // 4. Load specialized template
    let templateKey = 'generic';
    if (scenarioType === 'authentication') {
      templateKey = 'authentication';
    } else if (scenarioType === 'search') {
      templateKey = 'search';
    }
    
    const promptTemplate = await promptLoader.getPrompt('generator', templateKey);
    
    // Replace parameters
    const checklistStr = checklist.map((step, i) => `${i + 1}. ${step}`).join('\n');
    const generatorPrompt = promptTemplate
      .replaceAll('{domain}', domain)
      .replaceAll('{targetUrl}', targetUrl)
      .replaceAll('{scenarioType}', scenarioType)
      .replaceAll('{checklist}', checklistStr)
      .replaceAll('{selectorContext}', selectorContext)
      .replaceAll('{patternContext}', patternContext)
      .replaceAll('{domContext}', domContext)
      .replaceAll('{specialist}', specialist);

    console.log('[SpecialistGeneratorAgent] Requesting script from LLM...');
    const rawResponse = await llmClient.ask(generatorPrompt);
    
    // Extract code block
    let scriptContent = '';
    const match = rawResponse.match(/```(?:javascript|js)\s*([\s\S]*?)\s*```/);
    if (match) {
      scriptContent = match[1].trim();
    } else {
      scriptContent = rawResponse.trim();
    }

    if (!scriptContent.includes("test(") && !scriptContent.includes("expect(")) {
      throw new Error(`Invalid script output format. Received:\n${rawResponse}`);
    }

    // 5. Save the generated script to target path: tests/generated/{domain}/{runId}.spec.js
    const targetDir = path.join('tests', 'generated', domain);
    await fs.mkdir(targetDir, { recursive: true });
    
    const scriptPath = path.join(targetDir, `${runId}.spec.js`);
    await fs.writeFile(scriptPath, scriptContent, 'utf-8');
    console.log(`[SpecialistGeneratorAgent] Generated script saved to: ${scriptPath}`);

    // Compute script hash
    const scriptHash = crypto.createHash('sha256').update(scriptContent).digest('hex');

    // 6. Record version history in MongoDB
    const testRegistryRow = await memoryAgent.writeTestRegistry({
      runId,
      domain,
      scenarioType,
      scriptPath,
      scriptHash,
      validationScore: 10,
      passRate: 1.0,
      healingAttempts: 0,
      state: 'active'
    });

    await memoryAgent.saveScriptVersion({
      registryId: testRegistryRow.id,
      version: 1,
      content: scriptContent,
      generatedBy: specialist,
      promptUsed: generatorPrompt,
      patternsInjected: activePatterns.map(p => p.id),
      selectorsInjected: provenSelectors.map(s => s.id)
    });

    return {
      runId,
      domain,
      scenarioType,
      scriptPath,
      scriptContent,
      scriptHash,
      registryId: testRegistryRow.id,
      specialist
    };
  }
}

const specialistGeneratorAgent = new SpecialistGeneratorAgent();
export default specialistGeneratorAgent;
