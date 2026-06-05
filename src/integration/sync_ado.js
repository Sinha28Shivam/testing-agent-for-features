import { syncScenarios } from './AdoFetcher.js';

async function run() {
  console.log('[ADO Sync] Starting manual synchronization script...');
  const success = await syncScenarios();
  if (success) {
    console.log('[ADO Sync] Manual synchronization finished successfully.');
    process.exit(0);
  } else {
    console.error('[ADO Sync Error] Manual synchronization failed.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('[ADO Sync Fatal Error]', err);
  process.exit(1);
});
