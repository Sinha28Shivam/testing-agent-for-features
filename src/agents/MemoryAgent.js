import pg from 'pg';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import messageBus, { EVENTS } from '../core/MessageBus.js';

dotenv.config();

const pgUri = process.env.POSTGRES_URI || 'postgresql://postgres:1234@localhost:5432/mydb';
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mydb';

class MemoryAgent {
  constructor() {
    this.pgPool = new pg.Pool({ connectionString: pgUri });
    this.mongoClient = new MongoClient(mongoUri);
    this.mongoDb = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;
    
    // Connect PostgreSQL (recreate if ended)
    if (!this.pgPool || this.pgPool.ended) {
      this.pgPool = new pg.Pool({ connectionString: pgUri });
    }
    const client = await this.pgPool.connect();
    client.release();
    
    // Connect MongoDB (recreate client)
    this.mongoClient = new MongoClient(mongoUri);
    await this.mongoClient.connect();
    const dbName = mongoUri.split('/').pop() || 'mydb';
    this.mongoDb = this.mongoClient.db(dbName);
    
    this.connected = true;
    console.log('[MemoryAgent] Connected successfully to Postgres and MongoDB (v3.0).');

    // Start event subscriptions
    this.setupSubscriptions();
  }

  setupSubscriptions() {
    // Listen to success/failure events to update accessibility patterns automatically
    messageBus.subscribe(EVENTS.SUCCESS_RECORD, async (payload) => {
      console.log(`[MemoryAgent] SUCCESS_RECORD received:`, payload);
      await this.recordPatternSuccess(payload);
    });

    messageBus.subscribe(EVENTS.FAILURE_RECORD, async (payload) => {
      console.log(`[MemoryAgent] FAILURE_RECORD received:`, payload);
      await this.recordPatternFailure(payload);
    });
  }

  // --- Domain Profiles ---
  async getDomainProfile(domain) {
    const query = 'SELECT * FROM domain_profiles WHERE domain = $1';
    const res = await this.pgPool.query(query, [domain]);
    return res.rows[0] || null;
  }

  async createOrUpdateDomainProfile(domain, updates = {}) {
    const existing = await this.getDomainProfile(domain);
    if (!existing) {
      const query = `
        INSERT INTO domain_profiles (
          domain, shadow_dom, auth_required, spa, volatility,
          avg_steps_per_run, avg_copilot_calls_per_run, avg_run_duration_ms, replay_success_rate,
          total_explore_runs, total_replay_runs
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;
      const res = await this.pgPool.query(query, [
        domain,
        updates.shadow_dom ?? false,
        updates.auth_required ?? false,
        updates.spa ?? false,
        updates.volatility ?? 'medium',
        updates.avg_steps_per_run ?? 0,
        updates.avg_copilot_calls_per_run ?? 0,
        updates.avg_run_duration_ms ?? 0,
        updates.replay_success_rate ?? 0.0,
        updates.total_explore_runs ?? 0,
        updates.total_replay_runs ?? 0
      ]);
      return res.rows[0];
    } else {
      // Build dynamic update
      const fields = [];
      const values = [];
      let idx = 1;
      
      const allowedKeys = [
        'shadow_dom', 'auth_required', 'spa', 'volatility',
        'avg_steps_per_run', 'avg_copilot_calls_per_run', 'avg_run_duration_ms', 'replay_success_rate',
        'total_explore_runs', 'total_replay_runs', 'last_explore_at', 'last_run_at'
      ];
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
        UPDATE domain_profiles 
        SET ${fields.join(', ')} 
        WHERE domain = $${idx}
        RETURNING *
      `;
      const res = await this.pgPool.query(query, values);
      return res.rows[0];
    }
  }

  // --- Accessibility Patterns ---
  async getAccessibilityPatterns(domain, intent = null) {
    let query = `
      SELECT * FROM accessibility_patterns 
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

  async recordPatternSuccess(payload) {
    const { domain, intent, pattern, alternative_pattern } = payload;
    if (!domain || !intent || !pattern) return;

    const query = `
      INSERT INTO accessibility_patterns (domain, intent, pattern, alternative_pattern, success_count, success_rate, state, last_verified_at)
      VALUES ($1, $2, $3, $4, 1, 1.0, 'candidate', NOW())
      ON CONFLICT (domain, intent, pattern) DO UPDATE SET
        success_count = accessibility_patterns.success_count + 1,
        success_rate = CAST(accessibility_patterns.success_count + 1 AS DECIMAL) / (accessibility_patterns.success_count + 1 + accessibility_patterns.failure_count),
        state = CASE WHEN accessibility_patterns.success_count + 1 >= 3 THEN 'verified' ELSE accessibility_patterns.state END,
        last_verified_at = NOW()
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [domain, intent, pattern, alternative_pattern || null]);
    return res.rows[0];
  }

  async recordPatternFailure(payload) {
    const { domain, intent, pattern } = payload;
    if (!domain || !intent || !pattern) return;

    const query = `
      INSERT INTO accessibility_patterns (domain, intent, pattern, failure_count, success_rate, state)
      VALUES ($1, $2, $3, 1, 0.0, 'candidate')
      ON CONFLICT (domain, intent, pattern) DO UPDATE SET
        failure_count = accessibility_patterns.failure_count + 1,
        success_rate = CAST(accessibility_patterns.success_count AS DECIMAL) / (accessibility_patterns.success_count + accessibility_patterns.failure_count + 1),
        state = CASE WHEN accessibility_patterns.failure_count + 1 >= 5 THEN 'stale' ELSE accessibility_patterns.state END
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [domain, intent, pattern]);
    return res.rows[0];
  }

  // --- Action Sequences (for Replay) ---
  async getActionSequence(domain, scenarioType) {
    const query = `
      SELECT * FROM action_sequences 
      WHERE domain = $1 AND scenario_type = $2 AND state IN ('candidate', 'verified')
    `;
    const res = await this.pgPool.query(query, [domain, scenarioType]);
    return res.rows[0] || null;
  }

  async saveActionSequence(data) {
    const query = `
      INSERT INTO action_sequences (domain, scenario_type, sequence, source_run_id, state, last_replayed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (domain, scenario_type) DO UPDATE SET
        sequence = EXCLUDED.sequence,
        source_run_id = EXCLUDED.source_run_id,
        state = EXCLUDED.state,
        last_replayed_at = NOW()
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.domain,
      data.scenarioType,
      JSON.stringify(data.sequence),
      data.sourceRunId || null,
      data.state || 'candidate'
    ]);
    return res.rows[0];
  }

  async recordReplayResult(domain, scenarioType, success) {
    const existing = await this.getActionSequence(domain, scenarioType);
    if (!existing) return;

    let query = '';
    if (success) {
      query = `
        UPDATE action_sequences
        SET success_count = success_count + 1,
            state = CASE WHEN success_count + 1 >= 3 THEN 'verified'::VARCHAR ELSE state END,
            last_replayed_at = NOW()
        WHERE domain = $1 AND scenario_type = $2
        RETURNING *
      `;
    } else {
      query = `
        UPDATE action_sequences
        SET failure_count = failure_count + 1,
            state = CASE WHEN failure_count + 1 >= 3 THEN 'stale'::VARCHAR ELSE state END,
            last_failed_at = NOW()
        WHERE domain = $1 AND scenario_type = $2
        RETURNING *
      `;
    }
    const res = await this.pgPool.query(query, [domain, scenarioType]);
    return res.rows[0];
  }

  // --- Failure Log ---
  async writeFailureLog(data) {
    const query = `
      INSERT INTO failure_log (
        run_id, domain, scenario_type, failed_at_step, tool_that_failed, error_type, error_message, snapshot_at_failure, copilot_last_decision
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.runId,
      data.domain,
      data.scenarioType,
      data.failedAtStep || null,
      data.toolThatFailed || null,
      data.errorType || null,
      data.errorMessage || null,
      data.snapshotAtFailure || null,
      data.copilotLastDecision || null
    ]);
    return res.rows[0];
  }

  // --- Run History ---
  async writeRunHistory(data) {
    const query = `
      INSERT INTO run_history (
        run_id, prompt, domain, scenario_type, execution_mode, total_steps, copilot_calls, mcp_tool_calls, passed, healing_attempts, push_decision, duration_ms, cold_start, replay_fallback_to_explore
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    const res = await this.pgPool.query(query, [
      data.runId,
      data.prompt,
      data.domain,
      data.scenarioType,
      data.executionMode || 'explore',
      data.totalSteps || 0,
      data.copilotCalls || 0,
      data.mcpToolCalls || 0,
      data.passed ?? false,
      data.healingAttempts || 0,
      data.pushDecision || 'skipped',
      data.durationMs || 0,
      data.coldStart ?? false,
      data.replayFallbackToExplore ?? false
    ]);
    return res.rows[0];
  }

  // --- Test Registry ---
  async writeTestRegistry(data) {
    const queryInsert = `
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

  // --- MongoDB: Page Snapshots ---
  async savePageSnapshot(snapshot) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('page_snapshots');
    await col.insertOne({
      domain: snapshot.domain,
      url: snapshot.url,
      snapshotHash: snapshot.snapshotHash,
      accessibilityTree: snapshot.accessibilityTree,
      capturedAt: new Date(),
      runId: snapshot.runId
    });
    console.log(`[MemoryAgent] Page snapshot saved to MongoDB for domain ${snapshot.domain}`);
  }

  async getLatestPageSnapshot(domain) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('page_snapshots');
    return await col.findOne({ domain }, { sort: { capturedAt: -1 } });
  }

  // --- MongoDB: Action Logs ---
  async saveActionLog(actionLog) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('action_logs');
    await col.insertOne({
      runId: actionLog.runId,
      domain: actionLog.domain,
      scenarioType: actionLog.scenarioType,
      executionMode: actionLog.executionMode,
      actions: actionLog.actions,
      totalSteps: actionLog.totalSteps,
      durationMs: actionLog.durationMs,
      completed: actionLog.completed,
      completionReason: actionLog.completionReason,
      copilotCallsUsed: actionLog.copilotCallsUsed
    });
    console.log(`[MemoryAgent] Action log saved to MongoDB for run ${actionLog.runId}`);
  }

  async getActionLog(runId) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('action_logs');
    return await col.findOne({ runId });
  }

  // --- MongoDB: Script Versions ---
  async saveScriptVersion(versionData) {
    if (!this.connected) await this.connect();
    const col = this.mongoDb.collection('script_versions');
    await col.insertOne({
      domain: versionData.domain,
      version: versionData.version || 1,
      content: versionData.content,
      generatedFromRunId: versionData.generatedFromRunId,
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
