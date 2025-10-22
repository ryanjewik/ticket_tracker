// src/server.ts
import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { ensureMetricsServer } from './metrics';
import { runScrape } from './index';

// Helpers
function parseEnvList(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(/[\n,;]+/g).map(s => s.trim()).filter(Boolean);
}

// Config
const SCHEDULE_CRON = cron.validate(process.env.SCHEDULE_CRON || '') ? process.env.SCHEDULE_CRON! : '*/30 * * * *';
const STUBHUB_URLS = parseEnvList('STUBHUB_URL');
const TICKETMASTER_URLS = parseEnvList('TICKETMASTER_URL');
const VIVIDSEATS_URLS = parseEnvList('VIVIDSEATS_URL');

// Start /metrics once
ensureMetricsServer();

async function scrapeAll() {
  const jobs: Promise<any>[] = [];

  for (const url of STUBHUB_URLS) {
    jobs.push(
      runScrape(url, 'stubhub.com').catch(err => {
        console.error('[scheduler] StubHub scrape failed', err);
      })
    );
  }
  for (const url of TICKETMASTER_URLS) {
    jobs.push(
      runScrape(url, 'ticketmaster.com').catch(err => {
        console.error('[scheduler] Ticketmaster scrape failed', err);
      })
    );
  }
  for (const url of VIVIDSEATS_URLS) {
    jobs.push(
      runScrape(url, 'vividseats.com').catch(err => {
        console.error('[scheduler] VividSeats scrape failed', err);
      })
    );
  }

  // Run all in parallel; wait for all to finish
  await Promise.allSettled(jobs);
}

// Run immediately, then on schedule
scrapeAll().catch(() => {});
cron.schedule(SCHEDULE_CRON, () => {
  console.log(`[scheduler] tick (${SCHEDULE_CRON}) running ${STUBHUB_URLS.length + TICKETMASTER_URLS.length + VIVIDSEATS_URLS.length} jobs`);
  scrapeAll().catch(() => {});
});

// graceful exit
process.on('SIGTERM', () => process.exit(0));
