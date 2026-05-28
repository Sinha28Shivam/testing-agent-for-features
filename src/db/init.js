import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.POSTGRES_URI || 'postgresql://postgres:1234@localhost:5432/mydb';

const schemaSql = `
-- Drop existing tables if they exist (for a clean setup)
DROP TABLE IF EXISTS run_history CASCADE;
DROP TABLE IF EXISTS test_registry CASCADE;
DROP TABLE IF EXISTS pattern_library CASCADE;
DROP TABLE IF EXISTS failure_log CASCADE;
DROP TABLE IF EXISTS selector_registry CASCADE;
DROP TABLE IF EXISTS site_profiles CASCADE;

-- Site profiles: what we know about each domain
CREATE TABLE site_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    shadow_dom BOOLEAN DEFAULT FALSE,
    auth_required BOOLEAN DEFAULT FALSE,
    spa BOOLEAN DEFAULT FALSE,
    volatility VARCHAR(10) DEFAULT 'medium', -- low | medium | high
    dom_extraction_mode VARCHAR(20) DEFAULT 'standard', -- standard | deep | shallow
    avg_healing_attempts DECIMAL(4,2) DEFAULT 0,
    total_runs INTEGER DEFAULT 0,
    last_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Selector registry: proven selectors per domain + intent
CREATE TABLE selector_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(255) NOT NULL,
    intent VARCHAR(100) NOT NULL,       -- e.g., 'login_email_field', 'search_input'
    selector TEXT NOT NULL,
    selector_type VARCHAR(50),          -- getByRole | getByLabel | css | xpath
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,4) DEFAULT 0,
    state VARCHAR(20) DEFAULT 'candidate', -- candidate | verified | stale | deprecated
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(domain, intent, selector)
);

-- Failure log: raw failure records
CREATE TABLE failure_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,
    test_title TEXT,
    error_type VARCHAR(50),             -- timeout | selector | navigation | assertion | network
    error_message TEXT,
    selector_used TEXT,
    fix_attempted TEXT,
    fix_succeeded BOOLEAN,
    healing_attempt_number INTEGER DEFAULT 1,
    cold_start BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Pattern library: distilled knowledge from failure log
CREATE TABLE pattern_library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_key VARCHAR(200) UNIQUE NOT NULL,
    scope VARCHAR(30) NOT NULL,         -- domain_specific | framework_specific | global
    scope_value VARCHAR(255),           -- the domain or framework name, null for global
    scenario_type VARCHAR(50),
    description TEXT NOT NULL,
    rule TEXT NOT NULL,                 -- the actual rule to inject into prompts
    confidence_score DECIMAL(5,4) DEFAULT 0,
    confirmation_count INTEGER DEFAULT 0,
    state VARCHAR(20) DEFAULT 'candidate', -- candidate | active | deprecated
    source_failure_ids UUID[],
    created_at TIMESTAMP DEFAULT NOW(),
    activated_at TIMESTAMP,
    last_confirmed_at TIMESTAMP
);

-- Test registry: all stored test scripts
CREATE TABLE test_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL,
    script_path TEXT NOT NULL,
    script_hash VARCHAR(64),            -- SHA256 for dedup
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

-- Run history: every pipeline execution
CREATE TABLE run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) UNIQUE NOT NULL,
    prompt TEXT NOT NULL,
    domain VARCHAR(255),
    scenario_types VARCHAR(50)[],
    total_tests INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    healing_attempts INTEGER DEFAULT 0,
    model_used VARCHAR(100),
    fallback_used BOOLEAN DEFAULT FALSE,
    push_decision VARCHAR(10),          -- pushed | skipped | failed
    duration_ms INTEGER,
    cold_start BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_failure_log_domain_scenario ON failure_log(domain, scenario_type, created_at DESC);
CREATE INDEX idx_selector_registry_domain_intent ON selector_registry(domain, intent, state);
CREATE INDEX idx_pattern_library_scope ON pattern_library(scope, scope_value, state);
CREATE INDEX idx_run_history_domain ON run_history(domain, created_at DESC);
`;

async function initDb() {
  console.log('Connecting to PostgreSQL using:', connectionString);
  const client = new pg.Client({ connectionString });
  
  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully.');
    
    console.log('Executing schema SQL...');
    await client.query(schemaSql);
    console.log('Database tables and indexes created successfully.');
  } catch (error) {
    console.error('Error creating database schema:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

initDb();
