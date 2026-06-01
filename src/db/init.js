import pg from 'pg';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.POSTGRES_URI || 'postgresql://postgres:1234@localhost:5432/mydb';
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mydb';

const schemaSql = `
-- Drop existing tables if they exist (for a clean setup)
DROP TABLE IF EXISTS domain_profiles CASCADE;
DROP TABLE IF EXISTS action_sequences CASCADE;
DROP TABLE IF EXISTS accessibility_patterns CASCADE;
DROP TABLE IF EXISTS failure_log CASCADE;
DROP TABLE IF EXISTS pattern_library CASCADE;
DROP TABLE IF EXISTS test_registry CASCADE;
DROP TABLE IF EXISTS run_history CASCADE;

-- Domain profiles: expanded from site_profiles
CREATE TABLE domain_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    shadow_dom BOOLEAN DEFAULT FALSE,
    auth_required BOOLEAN DEFAULT FALSE,
    spa BOOLEAN DEFAULT FALSE,
    volatility VARCHAR(10) DEFAULT 'medium', -- low | medium | high
    avg_steps_per_run DECIMAL(5,2) DEFAULT 0,
    avg_copilot_calls_per_run DECIMAL(5,2) DEFAULT 0,
    avg_run_duration_ms INTEGER DEFAULT 0,
    replay_success_rate DECIMAL(5,4) DEFAULT 0,
    total_explore_runs INTEGER DEFAULT 0,
    total_replay_runs INTEGER DEFAULT 0,
    last_explore_at TIMESTAMP,
    last_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Action sequences: stored replay programs
CREATE TABLE action_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,
    sequence JSONB NOT NULL, -- [{tool, intent, accessibilityPattern, args, ...}]
    source_run_id VARCHAR(100),
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    state VARCHAR(20) DEFAULT 'candidate', -- candidate | verified | stale | deprecated
    last_replayed_at TIMESTAMP,
    last_failed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(domain, scenario_type)
);

-- Accessibility patterns: stable element patterns per domain + intent
CREATE TABLE accessibility_patterns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL,
    intent VARCHAR(100) NOT NULL, -- e.g., 'login_email', 'search_input'
    pattern TEXT NOT NULL,         -- e.g., "getByLabel('Email address')"
    alternative_pattern TEXT,      -- fallback if primary fails
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,4) DEFAULT 0,
    state VARCHAR(20) DEFAULT 'candidate', -- candidate | verified | stale | deprecated
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(domain, intent, pattern)
);

-- Run history: replaces v2.0, adds MCP metrics
CREATE TABLE run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) UNIQUE NOT NULL,
    prompt TEXT NOT NULL,
    domain VARCHAR(255),
    scenario_type VARCHAR(50),
    execution_mode VARCHAR(10), -- explore | replay
    total_steps INTEGER DEFAULT 0,
    copilot_calls INTEGER DEFAULT 0,
    mcp_tool_calls INTEGER DEFAULT 0,
    passed BOOLEAN DEFAULT FALSE,
    healing_attempts INTEGER DEFAULT 0, -- should always be 0 in v3.0
    push_decision VARCHAR(10),
    duration_ms INTEGER,
    cold_start BOOLEAN DEFAULT FALSE,
    replay_fallback_to_explore BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Failure log: simplified
CREATE TABLE failure_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,
    failed_at_step INTEGER,
    tool_that_failed VARCHAR(100),
    error_type VARCHAR(50), -- navigation | element_not_found | timeout | ...
    error_message TEXT,
    snapshot_at_failure TEXT,
    copilot_last_decision TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Pattern library: distilled knowledge (kept from v2.0)
CREATE TABLE pattern_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_key VARCHAR(200) UNIQUE NOT NULL,
    scope VARCHAR(30) NOT NULL, -- domain_specific | framework_specific | global
    scope_value VARCHAR(255),
    scenario_type VARCHAR(50),
    description TEXT NOT NULL,
    rule TEXT NOT NULL,
    confidence_score DECIMAL(5,4) DEFAULT 0,
    confirmation_count INTEGER DEFAULT 0,
    state VARCHAR(20) DEFAULT 'candidate', -- candidate | active | deprecated
    source_failure_ids UUID[],
    created_at TIMESTAMP DEFAULT NOW(),
    activated_at TIMESTAMP,
    last_confirmed_at TIMESTAMP
);

-- Test registry: kept from v2.0
CREATE TABLE test_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,
    script_path TEXT NOT NULL,
    script_hash VARCHAR(64),
    validation_score INTEGER,
    pass_rate DECIMAL(5,4),
    healing_attempts INTEGER DEFAULT 0,
    stability_score DECIMAL(5,4) DEFAULT 1.0,
    state VARCHAR(20) DEFAULT 'active', -- active | stale | deprecated | flaky
    pushed_to_branch VARCHAR(200),
    last_run_at TIMESTAMP,
    total_runs INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_action_sequences_domain ON action_sequences(domain, scenario_type);
CREATE INDEX idx_accessibility_patterns_domain ON accessibility_patterns(domain, intent, state);
CREATE INDEX idx_run_history_domain ON run_history(domain, created_at DESC);
CREATE INDEX idx_failure_log_domain ON failure_log(domain, scenario_type, created_at DESC);
`;

async function initDb() {
  // 1. PostgreSQL Setup
  console.log('Connecting to PostgreSQL using:', connectionString);
  const pgClient = new pg.Client({ connectionString });
  
  try {
    await pgClient.connect();
    console.log('Connected to PostgreSQL successfully.');
    
    console.log('Executing schema SQL...');
    await pgClient.query(schemaSql);
    console.log('Database tables and indexes created successfully.');
  } catch (error) {
    console.error('Error creating database schema:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }

  // 2. MongoDB Setup
  console.log('\nConnecting to MongoDB using:', mongoUri);
  const mongoClient = new MongoClient(mongoUri);
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB successfully.');
    
    // Extract DB name from connection string
    const dbName = mongoUri.split('/').pop() || 'mydb';
    const db = mongoClient.db(dbName);
    
    // Create collections and indexes
    console.log('Initializing MongoDB collections and indexes...');
    const pageSnapshots = db.collection('page_snapshots');
    await pageSnapshots.createIndex({ domain: 1, capturedAt: -1 });
    
    const actionLogs = db.collection('action_logs');
    await actionLogs.createIndex({ runId: 1 });
    
    console.log('MongoDB initialization: SUCCESS');
  } catch (error) {
    console.error('Error initializing MongoDB:', error);
    process.exit(1);
  } finally {
    await mongoClient.close();
  }
}

initDb();
