import memoryAgent from './MemoryAgent.js';
import llmClient from '../core/LlmClient.js';
import messageBus, { EVENTS } from '../core/MessageBus.js';
import promptLoader from '../config/PromptLoader.js';

class PatternMinerAgent {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await memoryAgent.connect();

    // The miner can be run on-demand by listening to events or triggered directly.
    await messageBus.subscribe(EVENTS.PATTERN_MINED, async () => {
      console.log('[PatternMinerAgent] Pattern mining triggered...');
      await this.minePatterns();
    });

    this.initialized = true;
    console.log('[PatternMinerAgent] Subscribed to memory.pattern.mined.');
  }

  async minePatterns() {
    console.log('[PatternMinerAgent] Scanning failure logs to extract generalizable patterns...');
    
    // 1. Group failure logs in SQL to identify recurring issues
    const query = `
      SELECT 
        domain, 
        scenario_type, 
        error_type, 
        error_message, 
        COUNT(*) as occurrence_count,
        ARRAY_AGG(id) as source_ids
      FROM failure_log
      WHERE fix_succeeded = FALSE
      GROUP BY domain, scenario_type, error_type, error_message
      HAVING COUNT(*) >= 2
      ORDER BY occurrence_count DESC
      LIMIT 10
    `;

    try {
      const res = await memoryAgent.pgPool.query(query);
      const groups = res.rows;
      
      console.log(`[PatternMinerAgent] Found ${groups.length} recurring failure groups to analyze.`);

      for (const group of groups) {
        console.log(`[PatternMinerAgent] Analyzing failure group: ${group.domain} | ${group.error_type} (occurrences: ${group.occurrence_count})`);
        
        // Load miner prompt from YAML
        const promptTemplate = await promptLoader.getPrompt('pattern_miner', 'mine');
        const minerPrompt = promptTemplate
          .replaceAll('{domain}', group.domain)
          .replaceAll('{scenarioType}', group.scenario_type)
          .replaceAll('{error_type}', group.error_type)
          .replaceAll('{errorMessageSample}', group.error_message.substring(0, 300));

        try {
          const patternData = await llmClient.askJson(minerPrompt);
          console.log('[PatternMinerAgent] Extracted pattern candidate:', patternData);

          // 3. Save to database
          await memoryAgent.addPatternCandidate({
            patternKey: patternData.patternKey || `${group.domain}_${group.error_type}_${Date.now()}`,
            scope: patternData.scope || 'domain_specific',
            scopeValue: group.domain,
            scenarioType: group.scenario_type,
            description: patternData.description || `Auto-extracted pattern for ${group.domain} ${group.error_type}`,
            rule: patternData.rule,
            sourceFailureIds: group.source_ids
          });

          console.log(`[PatternMinerAgent] Pattern saved to database.`);
        } catch (err) {
          console.error(`[PatternMinerAgent] LLM failed for failure group:`, err.message);
        }
      }
    } catch (err) {
      console.error('[PatternMinerAgent] Error during pattern mining:', err.message);
    }
  }
}

const patternMinerAgent = new PatternMinerAgent();
export default patternMinerAgent;
