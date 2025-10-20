import dotenv from 'dotenv';
import cron from 'node-cron';
import { runScrape } from './index';

// Load .env if present
dotenv.config();

// Default: run every 30 minutes
const SCHEDULE_CRON = process.env.SCHEDULE_CRON || '*/30 * * * *';

console.log(`Scheduler starting — using cron expression: ${SCHEDULE_CRON}`);

// Schedule the job
const task = cron.schedule(SCHEDULE_CRON, async () => {
  console.log(`Job triggered at ${new Date().toISOString()}`);
  try {
    await runScrape();
  } catch (err) {
    console.error('Scheduled job failed:', err);
  }
});

// If run directly, also run once immediately
if (require.main === module) {
  (async () => {
    console.log('Running immediate scrape (manual start)');
    await runScrape();
    // Keep the scheduler running
    task.start();
  })();
}

export default task;
