import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URI || 'redis://localhost:6379';

export const EVENTS = {
  // Planning
  PLAN_REQUESTED:       'plan.requested',
  PLAN_CREATED:         'plan.created',

  // DOM Extraction
  DOM_EXTRACT_REQUESTED: 'dom.extract.requested',
  DOM_EXTRACTED:         'dom.extracted',
  DOM_EXTRACT_FAILED:    'dom.extract.failed',

  // Generation
  SCRIPT_GENERATE_REQUESTED: 'script.generate.requested',
  SCRIPT_GENERATED:          'script.generated',
  SCRIPT_GENERATE_FAILED:    'script.generate.failed',

  // Analysis
  STATIC_ANALYSIS_REQUESTED:  'analysis.static.requested',
  STATIC_ANALYSIS_COMPLETE:   'analysis.static.complete',
  RUNTIME_ANALYSIS_REQUESTED: 'analysis.runtime.requested',
  RUNTIME_ANALYSIS_COMPLETE:  'analysis.runtime.complete',

  // Execution
  TEST_EXECUTE_REQUESTED: 'test.execute.requested',
  TEST_EXECUTED:          'test.executed',

  // Healing
  HEALING_REQUESTED: 'healing.requested',
  HEALING_COMPLETE:  'healing.complete',
  HEALING_FAILED:    'healing.failed',

  // Memory
  FAILURE_RECORD:   'memory.failure.record',
  SUCCESS_RECORD:   'memory.success.record',
  PATTERN_MINED:    'memory.pattern.mined',
  PATTERN_MINED_COMPLETE: 'memory.pattern.mined.complete',

  // Push Decision
  PUSH_REVIEW_REQUESTED: 'push.review.requested',
  PUSH_DECISION_MADE:    'push.decision.made',

  // Output
  PUSH_REQUESTED: 'git.push.requested',
  PUSH_COMPLETE:  'git.push.complete',
  ISSUE_REQUESTED: 'issue.create.requested',
  REPORT_COMPLETE: 'report.complete',
};
Object.freeze(EVENTS);

class MessageBus {
  constructor() {
    this.pubClient = createClient({ url: redisUrl });
    this.subClient = createClient({ url: redisUrl });
    this.connected = false;
    this.subscriptions = new Map(); // topic -> Set of handlers
  }

  async connect() {
    if (this.connected) return;
    
    this.pubClient.on('error', (err) => console.error('[MessageBus Pub Client Error]', err));
    this.subClient.on('error', (err) => console.error('[MessageBus Sub Client Error]', err));

    await Promise.all([
      this.pubClient.connect(),
      this.subClient.connect()
    ]);

    this.connected = true;
    console.log(`[MessageBus] Connected successfully to Redis at ${redisUrl}`);
  }

  async publish(topic, payload) {
    if (!this.connected) await this.connect();
    
    const message = JSON.stringify({
      timestamp: new Date().toISOString(),
      payload
    });

    console.log(`[MessageBus] PUBLISH -> ${topic}`);
    await this.pubClient.publish(topic, message);
  }

  async subscribe(topic, handler) {
    if (!this.connected) await this.connect();

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
      
      // Setup the Redis subscription for this topic
      await this.subClient.subscribe(topic, (message) => {
        try {
          const parsed = JSON.parse(message);
          const handlers = this.subscriptions.get(topic);
          if (handlers) {
            for (const h of handlers) {
              h(parsed.payload, parsed.timestamp);
            }
          }
        } catch (err) {
          console.error(`[MessageBus] Error processing message on topic ${topic}:`, err);
        }
      });
      console.log(`[MessageBus] Subscribed to Redis channel: ${topic}`);
    }

    this.subscriptions.get(topic).add(handler);
  }

  async disconnect() {
    if (!this.connected) return;
    
    await Promise.all([
      this.pubClient.disconnect(),
      this.subClient.disconnect()
    ]);
    this.connected = false;
    console.log('[MessageBus] Disconnected successfully.');
  }
}

// Singleton instance
const messageBus = new MessageBus();
export default messageBus;
