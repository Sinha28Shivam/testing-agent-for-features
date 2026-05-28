import { spawn } from 'child_process';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import messageBus, { EVENTS } from '../core/MessageBus.js';

dotenv.config();

const redisUrl = process.env.REDIS_URI || 'redis://localhost:6379';

class GitAgent {
  constructor() {
    this.redisClient = createClient({ url: redisUrl });
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    await this.redisClient.connect();

    await messageBus.subscribe(EVENTS.PUSH_REQUESTED, async (payload) => {
      console.log(`[GitAgent] Push requested for script: ${payload.scriptPath}`);
      try {
        const result = await this.pushToGit(payload);
        await messageBus.publish(EVENTS.PUSH_COMPLETE, result);
      } catch (err) {
        console.error('[GitAgent Error] Git push failed:', err);
        await messageBus.publish(EVENTS.PUSH_COMPLETE, {
          runId: payload.runId,
          success: false,
          error: err.message
        });
      }
    });

    this.initialized = true;
    console.log('[GitAgent] Subscribed to git.push.requested.');
  }

  async pushToGit(payload) {
    const { runId, scriptPath } = payload;
    
    // 1. Acquire Redis-based soft lock to prevent concurrent git conflicts
    console.log('[GitAgent] Acquiring Redis git lock...');
    let lockAcquired = false;
    let retries = 5;
    
    while (retries > 0 && !lockAcquired) {
      // Set key with NX (only if not exists) and EX (expire in 30s)
      const res = await this.redisClient.set('git_lock', runId, { NX: true, EX: 30 });
      if (res === 'OK') {
        lockAcquired = true;
        console.log('[GitAgent] Redis lock ACQUIRED.');
      } else {
        retries--;
        console.warn(`[GitAgent] Redis lock busy. Retrying in 3 seconds... (${retries} retries left)`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!lockAcquired) {
      throw new Error('Failed to acquire Git write lock. A concurrent git operation is in progress.');
    }

    try {
      // 2. Perform Git Operations (add, commit, push)
      console.log(`[GitAgent] Adding file: ${scriptPath}`);
      await this.runGitCommand(['add', scriptPath]);

      console.log('[GitAgent] Committing changes...');
      const commitMsg = `Auto-generated test script for run ${runId}`;
      await this.runGitCommand(['commit', '-m', commitMsg]);

      console.log('[GitAgent] Pushing to remote repository...');
      // Push master branch to origin remote
      await this.runGitCommand(['push', 'origin', 'master']);

      console.log('[GitAgent] Git push completed successfully.');
      return {
        runId,
        success: true,
        pushedToBranch: 'origin/master'
      };

    } finally {
      // 3. Always release the lock
      console.log('[GitAgent] Releasing Redis git lock...');
      const lockVal = await this.redisClient.get('git_lock');
      if (lockVal === runId) {
        await this.redisClient.del('git_lock');
        console.log('[GitAgent] Redis lock RELEASED.');
      }
    }
  }

  runGitCommand(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          // If "nothing to commit" warning, count as success
          if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
            console.log('[GitAgent] Git reports: nothing to commit. Continuing.');
            resolve(stdout.trim());
          } else {
            reject(new Error(`Git command failed with code ${code}. Stderr: ${stderr}`));
          }
        }
      });
      
      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  async close() {
    await this.redisClient.disconnect();
  }
}

const gitAgent = new GitAgent();
export default gitAgent;
