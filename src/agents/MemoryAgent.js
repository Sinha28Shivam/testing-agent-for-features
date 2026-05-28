import pg from 'pg';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import messageBus, { EVENTS } from '../core/MessageBus.js';

dotenv.config();

const pgUri = process.env.POSTGRES_URI || 'postgresql://postgres:1234@localhost:5432/mydb';
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const mongoDbName = 'mydb';

class MemoryAgent {
  constructor() {
    this.pgPool = new pg.Pool({ connectionString: pgUri });
    this.mongoClient = new MongoClient(mongoUri);
    this.mongoDb = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;
    
    // Connect PostgreSQL
    await this.pgPool.connect();
    
    // Connect MongoDB
    await this.mongoClient.connect();
    this.mongoDb = this.mongoClient.db(mongoDbName);
    
    this.connected = true;
    console.log('[MemoryAgent] Connected successfully to Postgres and MongoDB.');

    // Start event subscriptions
    this.setupSubscriptions();
  }

  setupSubscriptions() {
    // Listen to success/failure events to update database automatically
    messageBus.subscribe(EVENTS.SUCCESS_RECORD, async (payload) => {
      console.log(`[MemoryAgent] SUCCESS_RECORD received:`, payload);
      await this.recordSuccess(payload);
    });

    messageBus.subscribe(EVENTS.FAILURE_RECORD, async (payload) => {
      console.log(`[MemoryAgent] FAILURE_RECORD received:`, payload);
      await this.recordFailure(payload);
    });
  }

  // --- Site Profiles ---
  async getSiteProfile(domain) {
    const query = 'SELECT * FROM site_profiles WHERE domain = $1';
    const res = await this.pgPool.query(query, [domain]);
    return res.rows[0] || null;
  }

  async createOrUpdateSiteProfile(domain, updates = {}) {
    const existing = await this.getSiteProfile(domain);
    if (!existing) {
      const query = `
        INSERT INTO site_profiles (
          domain, shadow_dom, auth_required, spa, volatility, dom_extraction_mode
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const res = await this.pgPool.query(query, [
        domain,
        updates.shadow_dom || false,
        updates.auth_required || false,
        updates.spa || false,
        updates.volatility || 'medium',
        updates.dom_extraction_mode || 'standard'
      ]);
      return res.rows[0];
    } else {
      // Build dynamic update
      const fields = [];
      const values = [];
      let idx = 1;
      
      const allowedKeys = ['shadow_dom', 'auth_required', 'spa', 'volatility', 'dom_extraction_mode', 'avg_healing_attempts', 'total_runs', 'last_run_at'];
      for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
          fields.push(`${key} = $${idx}`);
          values.push(updates[key]);
          idx++;
        }
      }
      
      if (fields.length === 0) return existing;
      
      fields.push(`updated_at = NOW()`);
      values.push(domain);
      const query = `
        UPDATE site_profiles 
        SET ${fields.join(', ')} 
        WHERE domain = $${idx}
        RETURNING *
      `;
      const res = await this.pgPool.query(query, values);
      return res.rows[0];
    }
  }

  // --- Selector Registry ---
  async getSelectorsForDomain(domain, intent = null) {
    let query = `
      SELECT * FROM selector_registry 
      WHERE domain = $1 AND state IN ('candidate', 'verified')
    `;
    const params = [domain];
    
    if (intent) {
      query += ' AND intent = $2';
      params.push(intent);
    }
    
    query += ' ORDER BY success_rate DESC, success_count DESC';
    const res = await this.pgPool.query(query, params);
    return res.rows;
  }

  async recordSuccess(payload) {
    const { domain, intent, selector, selector_type } = payload;
    if (!domain || !intent || !selector) return;

    const query = `
      INSERT INTO selector_registry (domain, intent, selector, selector_type, success_count, success_rate, state, last_verified_at)
      VALUES ($1, $2, $3, $4, 1, 1.0, 'candidate', NOW())
      ON CONFLICT (domain, intent, selector) DO UPDATE SET
        success_count = selector_registry.success_count + 1,
        success_rate = CAST(selector_registry.success_count + 1 AS DECIMAL) / (selector_registry.success_count + 1 + selector_registry.failure_count),
        state = CASE WHEN selector_registry.success_count + 1 >= 3 THEN 'verified' ELSE selector_registry.state END,
        last_verified_at = NOW()
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [domain, intent, selector, selector_type || 'css']);
    return res.rows[0];
  }

  async recordFailure(payload) {
    const { domain, intent, selector } = payload;
    if (!domain || !intent || !selector) return;

    const query = `
      INSERT INTO selector_registry (domain, intent, selector, failure_count, success_rate, state)
      VALUES ($1, $2, $3, 1, 0.0, 'candidate')
      ON CONFLICT (domain, intent, selector) DO UPDATE SET
        failure_count = selector_registry.failure_count + 1,
        success_rate = CAST(selector_registry.success_count AS DECIMAL) / (selector_registry.success_count + selector_registry.failure_count + 1),
        state = CASE WHEN selector_registry.failure_count + 1 >= 5 THEN 'stale' ELSE selector_registry.state END
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [domain, intent, selector]);
    return res.rows[0];
  }

  // --- Failure Log ---
  async writeFailureLog(data) {
    const query = `
      INSERT INTO failure_log (
        run_id, domain, scenario_type, test_title, error_type, error_message, selector_used, fix_attempted, fix_succeeded, healing_attempt_number, cold_start
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.runId,
      data.domain,
      data.scenarioType,
      data.testTitle || null,
      data.errorType || null,
      data.errorMessage || null,
      data.selectorUsed || null,
      data.fixAttempted || null,
      data.fixSucceeded || false,
      data.healingAttemptNumber || 1,
      data.coldStart || false
    ]);
    return res.rows[0];
  }

  // --- Run History ---
  async writeRunHistory(data) {
    const query = `
      INSERT INTO run_history (
        run_id, prompt, domain, scenario_types, total_tests, passed_tests, failed_tests, healing_attempts, model_used, fallback_used, push_decision, duration_ms, cold_start
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.runId,
      data.prompt,
      data.domain,
      data.scenarioTypes || [],
      data.totalTests || 0,
      data.passedTests || 0,
      data.failedTests || 0,
      data.healingAttempts || 0,
      data.modelUsed || 'gpt-4o-mini',
      data.fallbackUsed || false,
      data.pushDecision || 'skipped',
      data.durationMs || 0,
      data.coldStart || false
    ]);
    return res.rows[0];
  }

  // --- Test Registry ---
  async writeTestRegistry(data) {
    const query = `
      INSERT INTO test_registry (
        run_id, domain, scenario_type, script_path, script_hash, validation_score, pass_rate, healing_attempts, stability_score, state, pushed_to_branch, last_run_at, total_runs
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 1)
      ON CONFLICT (domain, scenario_type) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        script_path = EXCLUDED.script_path,
        script_hash = EXCLUDED.script_hash,
        validation_score = EXCLUDED.validation_score,
        pass_rate = EXCLUDED.pass_rate,
        healing_attempts = EXCLUDED.healing_attempts,
        stability_score = (test_registry.stability_score * test_registry.total_runs + EXCLUDED.pass_rate) / (test_registry.total_runs + 1),
        state = EXCLUDED.state,
        pushed_to_branch = EXCLUDED.pushed_to_branch,
        last_run_at = NOW(),
        total_runs = test_registry.total_runs + 1
      RETURNING *
    `;
    // Wait, the table constraint UNIQUE(domain, intent, selector) is there but is there a unique constraint for domain, scenario_type in test_registry?
    // Let's look at schema SQL we defined: CREATE TABLE test_registry ( ... );
    // There is NO unique constraint on test_registry(domain, scenario_type)!
    // Let's write an INSERT since we didn't specify UNIQUE(domain, scenario_type). Or let's update it based on domain and script_path if we want, or just insert it.
    // Let's modify query to just do INSERT, because we don't have UNIQUE constraint on domain and scenario_type.
    const queryInsert = `
      INSERT INTO test_registry (
        run_id, domain, scenario_type, script_path, script_hash, validation_score, pass_rate, healing_attempts, stability_score, state, pushed_to_branch, last_run_at, total_runs
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), 1)
      RETURNING *
    `;
    const res = await this.pgPool.query(queryInsert, [
      data.runId,
      data.domain,
      data.scenarioType,
      data.scriptPath,
      data.scriptHash || null,
      data.validationScore || 10,
      data.passRate || 1.0,
      data.healingAttempts || 0,
      data.stabilityScore || 1.0,
      data.state || 'active',
      data.pushedToBranch || null
    ]);
    return res.rows[0];
  }

  async getLatestTest(domain, scenarioType) {
    const query = `
      SELECT * FROM test_registry 
      WHERE domain = $1 AND scenario_type = $2 AND state = 'active'
      ORDER BY last_run_at DESC LIMIT 1
    `;
    const res = await this.pgPool.query(query, [domain, scenarioType]);
    return res.rows[0] || null;
  }

  // --- Pattern Library ---
  async getPatternLibrary(scenarioType = null) {
    let query = "SELECT * FROM pattern_library WHERE state = 'active'";
    const params = [];
    if (scenarioType) {
      query += " AND scenario_type = $1";
      params.push(scenarioType);
    }
    const res = await this.pgPool.query(query, params);
    return res.rows;
  }

  async addPatternCandidate(data) {
    const query = `
      INSERT INTO pattern_library (
        pattern_key, scope, scope_value, scenario_type, description, rule, confidence_score, confirmation_count, state, source_failure_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'candidate', $9)
      ON CONFLICT (pattern_key) DO UPDATE SET
        confirmation_count = pattern_library.confirmation_count + 1,
        confidence_score = CAST(pattern_library.confirmation_count + 1 AS DECIMAL) / (pattern_library.confirmation_count + 3),
        state = CASE WHEN pattern_library.confirmation_count + 1 >= 3 THEN 'active'::VARCHAR ELSE pattern_library.state END
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.patternKey,
      data.scope,
      data.scopeValue || null,
      data.scenarioType || null,
      data.description,
      data.rule,
      0.25, // initial confidence
      1,
      data.sourceFailureIds || []
    ]);
    return res.rows[0];
  }

  // --- MongoDB: DOM Snapshots ---
  async saveDomSnapshot(snapshot) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('dom_snapshots');
    await col.insertOne({
      runId: snapshot.runId,
      domain: snapshot.domain,
      url: snapshot.url,
      extractedAt: new Date(snapshot.extractedAt || Date.now()),
      elements: snapshot.elements || [],
      snapshotHash: snapshot.snapshotHash,
      previousSnapshotHash: snapshot.previousSnapshotHash || null,
      diffSummary: snapshot.diffSummary || null
    });
    console.log(`[MemoryAgent] DOM snapshot saved to MongoDB for domain ${snapshot.domain}`);
  }

  async getLatestDomSnapshot(domain) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('dom_snapshots');
    return await col.findOne({ domain }, { sort: { extractedAt: -1 } });
  }

  // --- MongoDB: Script Versions ---
  async saveScriptVersion(versionData) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('script_versions');
    await col.insertOne({
      registryId: versionData.registryId,
      version: versionData.version || 1,
      content: versionData.content,
      generatedBy: versionData.generatedBy,
      promptUsed: versionData.promptUsed,
      patternsInjected: versionData.patternsInjected || [],
      selectorsInjected: versionData.selectorsInjected || [],
      createdAt: new Date()
    });
    console.log(`[MemoryAgent] Script version saved to MongoDB`);
  }

  async disconnect() {
    await this.pgPool.end();
    await this.mongoClient.close();
    this.connected = false;
    console.log('[MemoryAgent] Disconnected.');
  }
}

const memoryAgent = new MemoryAgent();
export default memoryAgent;
