import fs from 'fs/promises';
import { watch } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import cron from 'node-cron';
import { bootstrap, executePipeline } from '../index.js';

const configPath = path.resolve('src/config/cron.yaml');

// Store active cron tasks to allow stopping/clearing them on reload
const activeTasks = new Map();

// Track currently executing jobs to prevent overlapping runs of the same task
const runningJobs = new Set();

/**
 * Loads schedules from the configuration file and starts the cron tasks.
 */
async function loadSchedules() {
  console.log('[Cron] Loading schedules from configuration...');
  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const parsed = yaml.load(fileContent);
    
    if (!parsed || !Array.isArray(parsed.jobs)) {
      console.warn('[Cron Warning] Invalid configuration structure. "jobs" array not found.');
      return;
    }

    let scheduledCount = 0;

    for (const job of parsed.jobs) {
      if (!job.name || !job.schedule || !job.target) {
        console.warn(`[Cron Warning] Skipping invalid job definition: ${JSON.stringify(job)}`);
        continue;
      }

      if (!job.enabled) {
        console.log(`[Cron] Job "${job.name}" is disabled. Skipping.`);
        continue;
      }

      // Validate cron expression
      if (!cron.validate(job.schedule)) {
        console.error(`[Cron Error] Job "${job.name}" has an invalid cron expression: "${job.schedule}". Skipping.`);
        continue;
      }

      // Schedule the task
      const task = cron.schedule(job.schedule, async () => {
        // Prevent concurrent execution of the same job
        if (runningJobs.has(job.name)) {
          console.warn(`[Cron Warning] Job "${job.name}" triggered, but the previous run is still executing. Skipping this execution.`);
          return;
        }

        runningJobs.add(job.name);
        console.log(`\n====================================================`);
        console.log(`[Cron] Triggered scheduled job: "${job.name}"`);
        console.log(`[Cron] Target: "${job.target}"`);
        console.log(`====================================================`);

        try {
          // Resolve target path if it points to a local file or run it as raw prompt
          let resolvedTarget = job.target;
          if (job.target.endsWith('.yaml') || job.target.endsWith('.yml') || job.target.endsWith('.txt')) {
            resolvedTarget = path.resolve(job.target);
            try {
              await fs.access(resolvedTarget);
            } catch {
              // Fallback to searching in root or config directories dynamically
              const fallbackPaths = [
                path.resolve('src/config', job.target),
                path.resolve('config', job.target),
                path.resolve(job.target)
              ];
              let found = false;
              for (const fp of fallbackPaths) {
                try {
                  await fs.access(fp);
                  resolvedTarget = fp;
                  found = true;
                  break;
                } catch {}
              }
              if (!found) {
                console.warn(`[Cron Warning] Target file "${job.target}" not found. Falling back to treating it as a raw prompt string.`);
                resolvedTarget = job.target;
              }
            }
          }

          console.log(`[Cron] Executing pipeline with target: "${resolvedTarget}"`);
          const result = await executePipeline(resolvedTarget, true);
          console.log(`[Cron] Job "${job.name}" finished execution. Success: ${result.success}`);
        } catch (err) {
          console.error(`[Cron Error] Job "${job.name}" failed during execution:`, err.message);
        } finally {
          runningJobs.delete(job.name);
        }
      });

      activeTasks.set(job.name, task);
      scheduledCount++;
      console.log(`[Cron] Successfully scheduled job "${job.name}" with schedule: "${job.schedule}"`);
    }

    console.log(`[Cron] Finished scheduling. Active jobs: ${scheduledCount}`);
  } catch (err) {
    console.error('[Cron Error] Failed to load schedule configuration:', err.message);
  }
}

/**
 * Stop and clear all active tasks.
 */
function clearTasks() {
  console.log('[Cron] Clearing active tasks...');
  for (const [name, task] of activeTasks.entries()) {
    task.stop();
    console.log(`[Cron] Stopped job: "${name}"`);
  }
  activeTasks.clear();
}

/**
 * Debounced hot-reload on config file changes.
 */
let reloadTimeout = null;
function handleConfigChange() {
  if (reloadTimeout) {
    clearTimeout(reloadTimeout);
  }
  
  reloadTimeout = setTimeout(async () => {
    console.log('\n[Cron] Configuration file change detected. Reloading...');
    clearTasks();
    await loadSchedules();
  }, 1000); // 1-second debounce
}

/**
 * Start the Cron Scheduler Service.
 */
async function start() {
  console.log('[Cron] Starting Cron Scheduler Service...');
  try {
    // 1. Initialize databases and message bus connections once
    await bootstrap();
    
    // 2. Load and register initial job schedules
    await loadSchedules();

    // 3. Setup dynamic file watcher for hot reloading schedules
    watch(configPath, (eventType) => {
      if (eventType === 'change') {
        handleConfigChange();
      }
    });
    console.log('[Cron] Config file watcher initialized successfully.');
    console.log('[Cron] Scheduler is running in background. Press Ctrl+C to terminate.');
  } catch (err) {
    console.error('[Cron Fatal Error] Failed to start scheduler service:', err.message);
    process.exit(1);
  }
}

start();
