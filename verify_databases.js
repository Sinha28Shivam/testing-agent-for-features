const { Client } = require('pg');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
require('dotenv').config();

async function verify() {
  console.log("Checking environment variables...");
  console.log("GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);
  console.log("OPENAI_API_KEY exists:", !!process.env.OPENAI_API_KEY);
  console.log("ANTHROPIC_API_KEY exists:", !!process.env.ANTHROPIC_API_KEY);
  console.log("GITHUB_TOKEN exists:", !!process.env.GITHUB_TOKEN);
  console.log("GITHUB_COPILOT_KEY exists:", !!process.env.GITHUB_COPILOT_KEY);

  // 1. PostgreSQL
  console.log("\nConnecting to PostgreSQL...");
  const pgClient = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '1234',
    database: 'mydb' // Default database in my-postgres container
  });
  try {
    await pgClient.connect();
    console.log("PostgreSQL connection: SUCCESS");
    const res = await pgClient.query('SELECT NOW()');
    console.log("PostgreSQL Time:", res.rows[0].now);
    await pgClient.end();
  } catch (err) {
    console.error("PostgreSQL connection: FAILED", err.message);
  }

  // 2. Redis
  console.log("\nConnecting to Redis...");
  const redisClient = createClient({
    url: 'redis://localhost:6379'
  });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  try {
    await redisClient.connect();
    console.log("Redis connection: SUCCESS");
    await redisClient.set('verify_key', 'OK');
    const val = await redisClient.get('verify_key');
    console.log("Redis GET verify_key:", val);
    await redisClient.disconnect();
  } catch (err) {
    console.error("Redis connection: FAILED", err.message);
  }

  // 3. MongoDB
  console.log("\nConnecting to MongoDB...");
  const mongoUrl = 'mongodb://localhost:27017';
  const mongoClient = new MongoClient(mongoUrl);
  try {
    await mongoClient.connect();
    console.log("MongoDB connection: SUCCESS");
    const db = mongoClient.db('mydb');
    const ping = await db.command({ ping: 1 });
    console.log("MongoDB ping:", ping);
    await mongoClient.close();
  } catch (err) {
    console.error("MongoDB connection: FAILED", err.message);
  }
}

verify().catch(console.error);
