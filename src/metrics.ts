// src/metrics.ts
import http from 'http';
import client from 'prom-client';

const METRICS_PORT = Number(process.env.SCRAPER_METRICS_PORT || 9464);

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const labelNames = ['source', 'url', 'scraped_at'] as const;

const listingsGauge = new client.Gauge({
  name: 'ticket_listings_count',
  help: 'Number of listings found',
  labelNames,
});
const avgGauge = new client.Gauge({
  name: 'ticket_avg_price',
  help: 'Average listing price',
  labelNames,
});
const medianGauge = new client.Gauge({
  name: 'ticket_median_price',
  help: 'Median listing price',
  labelNames,
});
const minGauge = new client.Gauge({
  name: 'ticket_min_price',
  help: 'Lowest listing price',
  labelNames,
});

registry.registerMetric(listingsGauge);
registry.registerMetric(avgGauge);
registry.registerMetric(medianGauge);
registry.registerMetric(minGauge);

/** Report one snapshot for an event/page */
export async function reportMetrics(opts: {
  source: string;      // e.g. 'StubHub'
  url: string;         // the scraped URL
  scrapedAtISO: string;
  count: number;
  avg: number;
  median: number;
  min: number;
}) {
  const labels = {
    source: opts.source,
    url: opts.url,
    scraped_at: opts.scrapedAtISO, // Note: high-cardinality label; OK for dev. For prod, consider removing.
  };
  listingsGauge.set(labels, opts.count);
  avgGauge.set(labels, opts.avg);
  medianGauge.set(labels, opts.median);
  minGauge.set(labels, opts.min);
}

// Start a simple /metrics server
let started = false;
export function ensureMetricsServer() {
  if (started) return;
  started = true;
  const server = http.createServer(async (_req, res) => {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });
  server.listen(METRICS_PORT, () =>
    console.log(`[metrics] listening on :${METRICS_PORT} /metrics`)
  );
}
