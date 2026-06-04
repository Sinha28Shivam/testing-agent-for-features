import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pgUri = process.env.POSTGRES_URI || 'postgresql://postgres:1234@localhost:5432/mydb';

async function check() {
  const pool = new pg.Pool({ connectionString: pgUri });
  await pool.connect();
  
  console.log("=== RUN HISTORY ===");
  const runs = await pool.query('SELECT run_id, prompt, passed, duration_ms, created_at FROM run_history ORDER BY created_at DESC LIMIT 20');
  console.table(runs.rows);
  
  console.log("\n=== TEST REGISTRY ===");
  const tests = await pool.query('SELECT run_id, domain, scenario_type, script_path, pass_rate, stability_score FROM test_registry ORDER BY last_run_at DESC LIMIT 20');
  console.table(tests.rows);

  await pool.end();
}

check().catch(console.error);
