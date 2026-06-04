import { spawn } from 'child_process';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
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
    const { runId, scriptPath, domain } = payload;
    
    // Read and back up the generated spec file content
    let scriptContent = null;
    try {
      scriptContent = await fs.readFile(scriptPath, 'utf-8');
    } catch (e) {
      console.warn(`[GitAgent] Could not read script content for backup: ${e.message}`);
    }
    
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

    const slug = domain ? domain.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() : 'default';
    const branchName = `auto-tests/${slug}`;

    try {
      // 2. Perform Git Operations (checkout branch, add, commit, push)
      console.log(`[GitAgent] Checking out branch: ${branchName}`);
      await this.runGitCommand(['checkout', '-B', branchName]);

      console.log(`[GitAgent] Adding file: ${scriptPath}`);
      await this.runGitCommand(['add', scriptPath]);

      console.log('[GitAgent] Committing changes...');
      const commitMsg = `Auto-generated test script for run ${runId}`;
      await this.runGitCommand(['commit', '-m', commitMsg]);

      console.log(`[GitAgent] Pushing branch ${branchName} to remote repository...`);
      await this.runGitCommand(['push', '-u', 'origin', branchName, '--force']);

      console.log('[GitAgent] Git push completed successfully.');
      return {
        runId,
        success: true,
        pushedToBranch: `origin/${branchName}`
      };

    } finally {
      // Switch back to master/main and merge the auto-test branch locally to preserve the generated test files
      let baseBranch = 'master';
      try {
        await this.runGitCommand(['checkout', 'master']);
      } catch (e) {
        try {
          await this.runGitCommand(['checkout', 'main']);
          baseBranch = 'main';
        } catch (e2) {
          baseBranch = null;
        }
      }

      if (baseBranch) {
        console.log(`[GitAgent] Merging branch ${branchName} into ${baseBranch} locally to preserve test files...`);
        await this.runGitCommand(['merge', branchName]).catch((err) => {
          console.error(`[GitAgent Warning] Local merge failed: ${err.message}`);
        });
      }

      // Restore/Preserve the spec file in local workspace
      if (scriptContent) {
        try {
          await fs.mkdir(path.dirname(scriptPath), { recursive: true });
          await fs.writeFile(scriptPath, scriptContent, 'utf-8');
          console.log(`[GitAgent] Restored/Preserved test file at: ${scriptPath}`);
        } catch (restoreErr) {
          console.error(`[GitAgent Error] Failed to restore script file: ${restoreErr.message}`);
        }
      }

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
