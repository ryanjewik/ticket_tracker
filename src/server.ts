import dotenv from 'dotenv';
import cron from 'node-cron';
import { runScrape } from './index';

// Load .env if present
dotenv.config();

// Default: run every 30 minutes
const SCHEDULE_CRON = process.env.SCHEDULE_CRON || '*/30 * * * *';

console.log(`Scheduler starting — using cron expression: ${SCHEDULE_CRON}`);

// Helper to gather configured URLs
function configuredUrls() {
  const list: Array<{ url: string; site: string }> = [];
  if (process.env.STUBHUB_URL) list.push({ url: process.env.STUBHUB_URL, site: 'stubhub' });
  if (process.env.VIVIDSEATS_URL) list.push({ url: process.env.VIVIDSEATS_URL, site: 'vividseats' });
  if (process.env.TICKETMASTER_URL) list.push({ url: process.env.TICKETMASTER_URL, site: 'ticketmaster' });
  if (process.env.SEATGEEK_URL) list.push({ url: process.env.SEATGEEK_URL, site: 'seatgeek' });
  return list;
}

// Schedule the job to iterate each configured url with small delay between runs
const task = cron.schedule(SCHEDULE_CRON, async () => {
  console.log(`Job triggered at ${new Date().toISOString()}`);
  const urls = configuredUrls();
  for (const entry of urls) {
    try {
      await runScrape(entry.url, entry.site);
    } catch (err) {
      console.error(`Scheduled job for ${entry.site} failed:`, err);
    }
    // small randomized delay to avoid burst behaviour
    await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000));
  }
});

// If run directly, also run once immediately
if (require.main === module) {
  (async () => {
    console.log('Running immediate scrape (manual start)');
    const urls = configuredUrls();
    for (const entry of urls) {
      try {
        await runScrape(entry.url, entry.site);
      } catch (err) {
        console.error(`Immediate run for ${entry.site} failed:`, err);
      }
      await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000));
    }
    // Keep the scheduler running
    task.start();
  })();
}

export default task;
